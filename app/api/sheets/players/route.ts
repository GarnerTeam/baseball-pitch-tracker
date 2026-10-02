import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/sheets/players?url=<webhookUrl>
 * Returns every player in the coach's persistent batter database (scoped to
 * their account) — the full list, not a per-keystroke search — so the
 * Lineup tab's name autocomplete can filter client-side exactly like the
 * existing My Team / Opposing Team autocomplete. Dual-mode auth like
 * /api/sheets/roster: a real Clerk session always wins over any
 * client-supplied `owner` param (only relevant for unauthenticated Scout
 * contexts).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const webhookUrl = searchParams.get('url');

  if (!webhookUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  const { userId: sessionUserId, orgId: sessionOrgId } = await auth();
  const ownerParam = searchParams.get('owner') ?? '';
  // Players are scoped to the Organization, not the individual coach — any
  // authorized teammate in the same org sees the same batter database.
  const organizationId = sessionOrgId || sessionUserId || ownerParam;

  if (!organizationId) {
    return NextResponse.json({ error: 'Missing owner — no session and no owner parameter provided' }, { status: 400 });
  }

  try {
    const json = await fetchPlayersFromScript(webhookUrl, organizationId);
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function fetchPlayersFromScript(webhookUrl: string, organizationId: string): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ action: 'players', organizationId });
  const res = await fetch(`${webhookUrl}?${qs.toString()}`, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'Cache-Control': 'no-cache' },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned non-JSON: ${text.slice(0, 300)}`);
  }
}

/**
 * Follow all redirects as POST — mirrors the helper in /api/sheets/route.ts.
 * Google Apps Script has a 2-hop redirect chain and Node's fetch downgrades
 * POST -> GET on 302, which would silently drop the write.
 */
async function postFollowingRedirects(
  url: string,
  body: string,
  maxHops = 5
): Promise<{ status: number; text: string }> {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(current, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) return { status: res.status, text: '' };
      current = next;
      continue;
    }

    const text = await res.text();
    return { status: res.status, text };
  }
  return { status: 0, text: 'Too many redirects' };
}

/**
 * POST /api/sheets/players
 * Body: { webhookUrl, name, number, hand }
 * Creates a brand-new player in the persistent database and returns the
 * created record, including the backend-generated permanent Player ID
 * ("PLR0001" style). Unlike pitch syncing, this is a synchronous
 * request/response — the caller needs the generated ID back immediately to
 * tag it onto the lineup slot and every pitch recorded against it. Every
 * write is stamped with the AUTHENTICATED user's id server-side — never
 * trust a client-supplied userId here, same rule as every other write route.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    // New players belong to the coach's Organization (shared batter
    // intelligence), not their personal account — falls back to userId
    // for solo coaches with no Organization set up yet.
    const organizationId = orgId || userId;

    const { webhookUrl, name, number, hand } = await req.json();
    const trimmedName = String(name ?? '').trim();
    const trimmedNumber = String(number ?? '').trim();

    if (!webhookUrl || !trimmedName) {
      return NextResponse.json({ error: 'Missing webhookUrl or name' }, { status: 400 });
    }

    const payload = {
      _kind: 'createPlayer',
      userId,
      name: trimmedName,
      number: trimmedNumber,
      hand: hand ?? '',
    };

    const { status, text } = await postFollowingRedirects(webhookUrl, JSON.stringify(payload));

    if (status >= 200 && status < 300) {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(text); } catch {
        return NextResponse.json({ error: `Apps Script returned non-JSON: ${text.slice(0, 300)}` }, { status: 502 });
      }
      if (body.status === 'error') {
        return NextResponse.json({ error: body.message }, { status: 500 });
      }
      if (body.player) {
        return NextResponse.json({ player: body.player });
      }
      // Fall through to the 405-style recovery below — doGet/doPost on this
      // webhook sometimes answers with a 2xx that has no usable body either.
    }

    // Known Apps Script web-app quirk: doPost() can run and persist the row
    // successfully, but the final redirect hop answers 405 with no body —
    // the write happened, we just can't read its return value directly.
    // Since player creation (unlike pitch/roster syncing) MUST hand the
    // caller back the backend-generated Player ID, recover by re-fetching
    // the full player list and picking out the record we just created
    // (exact name+number match, most recently created one if there are
    // several, which only happens if this exact name/number pair was
    // created before — astronomically unlikely to pick the wrong row).
    if (status === 405 || (status >= 200 && status < 300)) {
      try {
        const listJson = await fetchPlayersFromScript(webhookUrl, organizationId);
        const players = (listJson.players as Array<Record<string, unknown>> | undefined) ?? [];
        const candidates = players.filter(p =>
          String(p.name ?? '').trim().toLowerCase() === trimmedName.toLowerCase() &&
          String(p.number ?? '').trim() === trimmedNumber
        );
        const created = candidates[candidates.length - 1];
        if (created) {
          return NextResponse.json({ player: created });
        }
      } catch {
        // fall through to the error below
      }
      return NextResponse.json(
        { error: 'Player may have been created, but the server did not confirm it. Please check the autocomplete list and try again.' },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: `Unexpected status ${status}: ${text.slice(0, 200)}` },
      { status: 502 }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

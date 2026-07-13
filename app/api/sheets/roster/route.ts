import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/sheets/roster?url=<webhookUrl>&team=<teamName>
 * Returns the coach's saved roster for an opposing team, so a lineup can be
 * reloaded instead of re-typed every time the same team is faced again this
 * season. Dual-mode auth like /api/sheets/scout: a real Clerk session always
 * wins over any client-supplied `owner` param.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const webhookUrl = searchParams.get('url');
  const team = (searchParams.get('team') ?? '').trim();

  if (!webhookUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }
  if (!team) {
    return NextResponse.json({ error: 'Missing team parameter', players: [] }, { status: 400 });
  }

  const { userId: sessionUserId } = await auth();
  const ownerParam = searchParams.get('owner') ?? '';
  const userId = sessionUserId || ownerParam;

  if (!userId) {
    return NextResponse.json({ error: 'Missing owner — no session and no owner parameter provided' }, { status: 400 });
  }

  try {
    const qs = new URLSearchParams({ action: 'roster', team, userId });
    const res = await fetch(`${webhookUrl}?${qs.toString()}`, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'Cache-Control': 'no-cache' },
    });

    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json(
        { error: `Apps Script returned non-JSON: ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
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
 * POST /api/sheets/roster
 * Body: { webhookUrl, teamName, players: RosterPlayer[] }
 * Saves/updates the coach's roster for an opposing team. Every write is
 * stamped with the AUTHENTICATED user's id server-side — never trust a
 * client-supplied userId here, same rule as the pitch-sync route.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { webhookUrl, teamName, players } = await req.json();

    if (!webhookUrl || !teamName || !Array.isArray(players) || players.length === 0) {
      return NextResponse.json({ error: 'Missing webhookUrl, teamName, or players' }, { status: 400 });
    }

    const stamped = players.map((p: Record<string, unknown>) => ({
      _kind: 'roster',
      userId,
      teamName: String(teamName),
      playerId: p.id,
      name: p.name ?? '',
      number: p.number ?? '',
      hand: p.hand ?? '',
    }));

    const { status, text } = await postFollowingRedirects(webhookUrl, JSON.stringify(stamped));

    // 405 after execution is the normal Google Apps Script response — see
    // /api/sheets/route.ts for why this is a success signal, not an error.
    if (status === 405) {
      return NextResponse.json({ saved: stamped.length });
    }

    if (status >= 200 && status < 300) {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(text); } catch { /* non-JSON 2xx — still success */ }
      if (body.status === 'error') {
        return NextResponse.json({ error: body.message }, { status: 500 });
      }
      return NextResponse.json({ saved: stamped.length });
    }

    return NextResponse.json(
      { error: `Unexpected status ${status}: ${text.slice(0, 200)}` },
      { status: 502 }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

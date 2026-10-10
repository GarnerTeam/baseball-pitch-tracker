import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { resolveScriptUrl, scriptGet, scriptPost, scriptErrorBody } from '@/lib/apps-script';

/**
 * GET /api/sheets/roster?url=<webhookUrl>&team=<teamName>
 * Returns the coach's saved roster for an opposing team, so a lineup can be
 * reloaded instead of re-typed every time the same team is faced again this
 * season. Dual-mode auth like /api/sheets/scout: a real Clerk session always
 * wins over any client-supplied `owner` param.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const team = (searchParams.get('team') ?? '').trim();
  if (!team) {
    return NextResponse.json({ error: 'Missing team parameter', players: [] }, { status: 400 });
  }

  const { userId: sessionUserId, orgId: sessionOrgId } = await auth();
  const ownerParam = searchParams.get('owner') ?? '';
  const organizationId = sessionOrgId || sessionUserId || ownerParam;
  const userId = sessionUserId || ownerParam;

  if (!organizationId) {
    return NextResponse.json({ error: 'Missing owner — no session and no owner parameter provided' }, { status: 400 });
  }

  try {
    const url = resolveScriptUrl(searchParams.get('url'));
    const json = await scriptGet(url, { action: 'roster', team, organizationId, userId });
    return NextResponse.json(json);
  } catch (err) {
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * POST /api/sheets/roster
 * Body: { webhookUrl, teamName, players: RosterPlayer[] }
 * Saves/updates the coach's roster for an opposing team. Every write is
 * stamped with the AUTHENTICATED user's scope server-side.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const organizationId = orgId || userId;

    const { webhookUrl, teamName, players } = await req.json();
    if (!teamName || !Array.isArray(players) || players.length === 0) {
      return NextResponse.json({ error: 'Missing teamName or players' }, { status: 400 });
    }
    const url = resolveScriptUrl(webhookUrl);

    const stamped = players.map((p: Record<string, unknown>) => ({
      _kind: 'roster',
      organizationId,
      userId,
      teamName: String(teamName),
      playerId: p.id,
      name: p.name ?? '',
      number: p.number ?? '',
      hand: p.hand ?? '',
    }));

    const { status, text } = await scriptPost(url, stamped);

    // 405 after execution is the normal Apps Script response — doPost() ran;
    // only the redirect delivery hop refuses the repeated POST.
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
      { status: 502 },
    );
  } catch (err) {
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

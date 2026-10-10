import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { resolveScriptUrl, scriptErrorBody } from '@/lib/apps-script';
import { db, mirror, mirrorToSheet, mode, readAction, sheetWrite } from '@/lib/backend';
import { saveRoster } from '@/lib/db/store';

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
    const json = await readAction(url, 'roster', { organizationId, userId }, { team });
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

    if (mode() === 'database') {
      await saveRoster(db(), stamped);
      mirrorToSheet('roster', url, stamped);
      return NextResponse.json({ saved: stamped.length });
    }

    const r = await sheetWrite(url, stamped);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    if (mode() === 'dual') await mirror('roster', () => saveRoster(db(), stamped));
    return NextResponse.json({ saved: stamped.length });
  } catch (err) {
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

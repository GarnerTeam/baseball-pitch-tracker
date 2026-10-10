import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { resolveScriptUrl, scriptGet, scriptErrorBody } from '@/lib/apps-script';

/**
 * GET /api/sheets/history?url=<webhookUrl>&batter=<name>&num=<number>[&playerId=<id>][&owner=<userId>]
 * Batter history across every game in the coach's scope.
 *
 * Dual-mode auth, same pattern as /api/sheets/scout: a real Clerk session
 * always wins over any client-supplied `owner` param; the `owner` param only
 * matters for unauthenticated Scout-page visitors.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const batter = searchParams.get('batter') ?? '';
  const num = searchParams.get('num') ?? '';
  // Persistent player id (PLR… or roster-…) — the backend matches on it
  // exactly when present instead of name/number.
  const playerId = searchParams.get('playerId') ?? '';

  const { userId: sessionUserId, orgId: sessionOrgId } = await auth();
  const ownerParam = searchParams.get('owner') ?? '';
  const organizationId = sessionOrgId || sessionUserId || ownerParam;
  const userId = sessionUserId || ownerParam;

  if (!organizationId) {
    return NextResponse.json({ error: 'Missing owner — no session and no owner parameter provided' }, { status: 400 });
  }

  try {
    const url = resolveScriptUrl(searchParams.get('url'));
    const params: Record<string, string> = { action: 'history', batter, num, organizationId, userId };
    if (playerId) params.playerId = playerId;
    const json = await scriptGet(url, params);
    return NextResponse.json(json);
  } catch (err) {
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

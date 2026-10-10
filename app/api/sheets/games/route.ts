import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { resolveScriptUrl, scriptGet, scriptErrorBody } from '@/lib/apps-script';

/**
 * GET /api/sheets/games?url=<webhookUrl>
 * Proxies to Apps Script doGet(action=games) which scans the sheet and
 * returns a lightweight list of distinct games (gameId, teams, date, pitch
 * count) — powers the "Past Games" browser in the main app.
 *
 * Always authenticated (protected by middleware) — the scope comes from the
 * Clerk session, never from the client. Organization when the coach belongs
 * to one, otherwise the personal userId.
 */
export async function GET(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const organizationId = orgId || userId;
  const { searchParams } = new URL(req.url);

  try {
    const url = resolveScriptUrl(searchParams.get('url'));
    const json = await scriptGet(url, { action: 'games', organizationId, userId });
    return NextResponse.json(json);
  } catch (err) {
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

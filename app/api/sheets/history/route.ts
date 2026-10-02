import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/sheets/history?url=<webhookUrl>&batter=<name>&num=<number>[&owner=<userId>]
 * Proxies to the Apps Script doGet() endpoint which queries the full spreadsheet.
 *
 * Dual-mode auth, same pattern as /api/sheets/scout: a real Clerk session
 * always wins over any client-supplied `owner` param; the `owner` param only
 * matters for unauthenticated Scout-page visitors.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const webhookUrl = searchParams.get('url');
  const batter = searchParams.get('batter') ?? '';
  const num = searchParams.get('num') ?? '';
  // Saved Roster id — reliable identity signal that bypasses name/number
  // matching entirely on the backend when present (see lib/roster.ts).
  const playerId = searchParams.get('playerId') ?? '';

  if (!webhookUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  const { userId: sessionUserId, orgId: sessionOrgId } = await auth();
  const ownerParam = searchParams.get('owner') ?? '';
  // Organization-scoped: a real session's org always wins, then personal
  // userId, then the `owner` query param carried by Scout share links
  // (which now encodes whichever scope the sharing coach had).
  const organizationId = sessionOrgId || sessionUserId || ownerParam;
  const userId = sessionUserId || ownerParam;

  if (!organizationId) {
    return NextResponse.json({ error: 'Missing owner — no session and no owner parameter provided' }, { status: 400 });
  }

  try {
    const qs = new URLSearchParams({ action: 'history', batter, num, organizationId, userId });
    if (playerId) qs.set('playerId', playerId);
    // GET requests to Apps Script follow redirects normally
    const res = await fetch(`${webhookUrl}?${qs.toString()}`, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'Cache-Control': 'no-cache' },
    });

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return NextResponse.json(json);
    } catch {
      return NextResponse.json(
        { error: `Apps Script returned non-JSON: ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

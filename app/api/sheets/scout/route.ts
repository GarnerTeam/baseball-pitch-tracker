import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/sheets/scout?url=<webhookUrl>[&gameId=<id>][&owner=<userId>]
 * Proxies to Apps Script doGet(action=scout) which returns all pitches
 * for the latest game (or a specific gameId) — used by the Scout view AND
 * by the authenticated "Past Games" browser in the main app.
 *
 * Dual-mode auth: this route is public (unauthenticated Scout visitors have
 * no Clerk session), so it accepts an explicit `owner` param as the tenant
 * scope. BUT if a real Clerk session IS present (calls from the logged-in
 * main app), that always wins — a signed-in user can never override the
 * scope to read someone else's data by passing a different `owner`.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const webhookUrl = searchParams.get('url');
  const gameId     = searchParams.get('gameId') ?? '';

  if (!webhookUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  const { userId: sessionUserId } = await auth();
  const ownerParam = searchParams.get('owner') ?? '';
  const userId = sessionUserId || ownerParam;

  if (!userId) {
    return NextResponse.json({ error: 'Missing owner — no session and no owner parameter provided' }, { status: 400 });
  }

  try {
    const qs  = new URLSearchParams({ action: 'scout', gameId, userId });
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

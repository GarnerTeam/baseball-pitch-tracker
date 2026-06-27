import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/sheets/scout?url=<webhookUrl>[&gameId=<id>]
 * Proxies to Apps Script doGet(action=scout) which returns all pitches
 * for the latest game (or a specific gameId) — used by the Scout view.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const webhookUrl = searchParams.get('url');
  const gameId     = searchParams.get('gameId') ?? '';

  if (!webhookUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    const qs  = new URLSearchParams({ action: 'scout', gameId });
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

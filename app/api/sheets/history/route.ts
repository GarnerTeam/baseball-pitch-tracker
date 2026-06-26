import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/sheets/history?url=<webhookUrl>&batter=<name>&num=<number>
 * Proxies to the Apps Script doGet() endpoint which queries the full spreadsheet.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const webhookUrl = searchParams.get('url');
  const batter = searchParams.get('batter') ?? '';
  const num = searchParams.get('num') ?? '';

  if (!webhookUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    const qs = new URLSearchParams({ action: 'history', batter, num });
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

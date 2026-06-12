import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { webhookUrl, pitches } = await req.json();

    if (!webhookUrl || !pitches?.length) {
      return NextResponse.json({ error: 'Missing webhookUrl or pitches' }, { status: 400 });
    }

    // Forward to Google Apps Script server-to-server (no CORS issues)
    const gsRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(pitches),
      redirect: 'follow',
    });

    // Apps Script returns JSON — read it regardless of status
    const text = await gsRes.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { body = { raw: text }; }

    if (body.status === 'error') {
      console.error('[sheets proxy] Apps Script error:', body.message);
      return NextResponse.json({ error: body.message }, { status: 500 });
    }

    return NextResponse.json({ synced: pitches.length });
  } catch (err) {
    console.error('[sheets proxy] fetch error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

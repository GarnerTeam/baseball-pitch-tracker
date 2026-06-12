import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { webhookUrl, pitches } = await req.json();

    if (!webhookUrl || !pitches?.length) {
      return NextResponse.json({ error: 'Missing webhookUrl or pitches' }, { status: 400 });
    }

    // ── Step 1: POST to Google Apps Script with redirect: 'manual' ──────────
    // Google Apps Script redirects (302) from script.google.com →
    // script.googleusercontent.com. If we use redirect:'follow', Node's fetch
    // changes the method from POST to GET on a 302, meaning doPost() never fires.
    // Solution: intercept the redirect and re-POST to the Location URL ourselves.
    let gsRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(pitches),
      redirect: 'manual',        // do NOT auto-follow — we'll handle it
    });

    // ── Step 2: Follow redirect manually, preserving POST ───────────────────
    if (gsRes.status >= 300 && gsRes.status < 400) {
      const location = gsRes.headers.get('location');
      if (location) {
        gsRes = await fetch(location, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(pitches),
        });
      }
    }

    // ── Step 3: Validate response ────────────────────────────────────────────
    const text = await gsRes.text();

    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON response — HTML error page, auth wall, etc.
      console.error('[sheets proxy] non-JSON response from Apps Script:', text.slice(0, 300));
      return NextResponse.json(
        { error: `Apps Script returned non-JSON (status ${gsRes.status}): ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }

    if (body.status === 'error') {
      console.error('[sheets proxy] Apps Script error:', body.message);
      return NextResponse.json({ error: body.message }, { status: 500 });
    }

    if (!gsRes.ok) {
      console.error('[sheets proxy] HTTP error from Apps Script:', gsRes.status, text.slice(0, 200));
      return NextResponse.json(
        { error: `Apps Script HTTP ${gsRes.status}: ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }

    // ── Step 4: Success ──────────────────────────────────────────────────────
    console.log('[sheets proxy] synced', pitches.length, 'pitches successfully');
    return NextResponse.json({ synced: pitches.length });

  } catch (err) {
    console.error('[sheets proxy] fetch error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

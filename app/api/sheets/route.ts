import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { webhookUrl, pitches } = await req.json();

    if (!webhookUrl || !pitches?.length) {
      return NextResponse.json({ error: 'Missing webhookUrl or pitches' }, { status: 400 });
    }

    // ── Google Apps Script two-step execution flow ───────────────────────────
    //
    // Step 1: POST to /exec with redirect:manual
    //   → Google returns 302 to script.googleusercontent.com/...
    //
    // Step 2: POST to that redirect URL
    //   → THIS is what actually runs doPost() and writes the data
    //   → Google returns 405 after execution (response delivery uses a different
    //     channel) — 405 here is expected and means success, not failure
    //
    // Confirmed by testing: re-POSTing to redirect = data writes.
    // Switching to GET = nothing executes.

    // Step 1 — hit /exec, capture the redirect
    const execRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(pitches),
      redirect: 'manual',
    });

    if (execRes.status < 300 || execRes.status >= 400) {
      // No redirect — /exec responded directly (unusual)
      const text = await execRes.text();
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(text); } catch { /* ignore */ }
      if (body.status === 'error') {
        return NextResponse.json({ error: body.message }, { status: 500 });
      }
      if (!execRes.ok) {
        return NextResponse.json(
          { error: `Apps Script /exec returned ${execRes.status}: ${text.slice(0, 200)}` },
          { status: 502 }
        );
      }
      return NextResponse.json({ synced: pitches.length });
    }

    const location = execRes.headers.get('location');
    if (!location) {
      return NextResponse.json({ error: 'Apps Script returned redirect with no Location header' }, { status: 502 });
    }

    // Step 2 — POST to redirect URL to execute doPost()
    const runRes = await fetch(location, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(pitches),
    });

    // 405 is the normal response after doPost() runs — the execution succeeded,
    // the response delivery channel just doesn't accept another POST.
    if (runRes.status === 405) {
      console.log('[sheets proxy] doPost ran (405 expected), synced', pitches.length);
      return NextResponse.json({ synced: pitches.length });
    }

    // Any 2xx — also success, parse the body for logging
    if (runRes.ok) {
      const text = await runRes.text();
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(text); } catch { /* ignore */ }
      if (body.status === 'error') {
        return NextResponse.json({ error: body.message }, { status: 500 });
      }
      console.log('[sheets proxy] synced', pitches.length, 'response:', body);
      return NextResponse.json({ synced: pitches.length });
    }

    // Genuine failure on the execution step
    const errText = await runRes.text();
    console.error('[sheets proxy] execution step failed:', runRes.status, errText.slice(0, 300));
    return NextResponse.json(
      { error: `Apps Script execution returned ${runRes.status}: ${errText.slice(0, 200)}` },
      { status: 502 }
    );

  } catch (err) {
    console.error('[sheets proxy] fetch error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

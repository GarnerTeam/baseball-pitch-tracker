import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { webhookUrl, pitches } = await req.json();

    if (!webhookUrl || !pitches?.length) {
      return NextResponse.json({ error: 'Missing webhookUrl or pitches' }, { status: 400 });
    }

    // ── POST to Google Apps Script ───────────────────────────────────────────
    // Google Apps Script flow:
    //   1. POST /exec  →  Google runs doPost() and writes data  →  302 redirect
    //   2. GET the redirect URL  →  returns the JSON response from doPost()
    //
    // The 302 redirect URL is a *response delivery* endpoint, NOT a second
    // execution. It only accepts GET. Re-POSTing to it returns 405.
    // So we POST once (which executes the script), then GET the redirect URL
    // to retrieve the response.

    // Step 1: POST to execute the script — capture redirect, don't follow it
    const execRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(pitches),
      redirect: 'manual',
    });

    let responseText: string;

    if (execRes.status >= 300 && execRes.status < 400) {
      // Step 2: GET the redirect URL to retrieve the response JSON
      const location = execRes.headers.get('location');
      if (!location) {
        // No location header — treat the initial response body as the answer
        responseText = await execRes.text();
      } else {
        const getRes = await fetch(location, { method: 'GET' });
        responseText = await getRes.text();
        if (!getRes.ok && getRes.status !== 405) {
          console.error('[sheets proxy] GET response URL failed:', getRes.status);
        }
      }
    } else {
      // No redirect — direct response from /exec
      responseText = await execRes.text();
    }

    // Parse the Apps Script response
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(responseText);
    } catch {
      // Non-JSON from response delivery URL is normal when script returns HTML
      // or when the response delivery URL itself can't be reached.
      // The data was already written in Step 1 — treat as success if execRes
      // was a redirect (302 = script accepted and ran the request).
      if (execRes.status >= 300 && execRes.status < 400) {
        console.log('[sheets proxy] script ran (302 received), treating as success despite non-JSON response');
        return NextResponse.json({ synced: pitches.length });
      }
      console.error('[sheets proxy] non-JSON and no redirect:', responseText.slice(0, 300));
      return NextResponse.json(
        { error: `Apps Script returned non-JSON (status ${execRes.status}): ${responseText.slice(0, 200)}` },
        { status: 502 }
      );
    }

    if (body.status === 'error') {
      console.error('[sheets proxy] Apps Script error:', body.message);
      return NextResponse.json({ error: body.message }, { status: 500 });
    }

    console.log('[sheets proxy] synced', pitches.length, 'pitches. Apps Script count:', body.count);
    return NextResponse.json({ synced: pitches.length });

  } catch (err) {
    console.error('[sheets proxy] fetch error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

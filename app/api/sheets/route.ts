import { NextRequest, NextResponse } from 'next/server';

/**
 * Follow all redirects as POST, up to maxHops.
 * Google Apps Script has a 2-hop redirect chain:
 *   script.google.com/exec → script.google.com/... → script.googleusercontent.com/...
 * Node's fetch with redirect:'follow' changes POST→GET on 302, killing doPost().
 * This helper re-issues a POST at every hop until we get a non-3xx status.
 */
async function postFollowingRedirects(
  url: string,
  body: string,
  maxHops = 5
): Promise<{ status: number; text: string; hops: string[] }> {
  const hops: string[] = [];
  let current = url;

  for (let i = 0; i < maxHops; i++) {
    hops.push(current);
    const res = await fetch(current, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) {
        // Redirect with no Location — treat current as final
        return { status: res.status, text: '', hops };
      }
      current = next;
      continue;
    }

    const text = await res.text();
    return { status: res.status, text, hops };
  }

  return { status: 0, text: 'Too many redirects', hops };
}

export async function POST(req: NextRequest) {
  try {
    const { webhookUrl, pitches } = await req.json();

    if (!webhookUrl || !pitches?.length) {
      return NextResponse.json({ error: 'Missing webhookUrl or pitches' }, { status: 400 });
    }

    // Debug: log the URL being used (last 40 chars to avoid logging full secret)
    const urlTail = webhookUrl.slice(-40);
    console.log('[sheets proxy] using url tail:', urlTail, '| pitches:', pitches.length);

    const bodyStr = JSON.stringify(pitches);
    const { status, text, hops } = await postFollowingRedirects(webhookUrl, bodyStr);

    console.log('[sheets proxy] hops:', hops.length, 'final status:', status, 'url tail:', urlTail);

    // 405 after execution is the normal Google Apps Script response —
    // doPost() ran and wrote the data; the response delivery channel
    // doesn't accept another POST, hence 405.
    if (status === 405) {
      return NextResponse.json({ synced: pitches.length, _hops: hops.length, _urlTail: urlTail });
    }

    // Successful JSON response from doPost
    if (status >= 200 && status < 300) {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(text); } catch { /* non-JSON 2xx — still success */ }
      if (body.status === 'error') {
        return NextResponse.json({ error: body.message }, { status: 500 });
      }
      return NextResponse.json({ synced: pitches.length, _hops: hops.length, _urlTail: urlTail });
    }

    // 0 = too many redirects, or any other unexpected status
    console.error('[sheets proxy] unexpected status', status, text.slice(0, 300));
    return NextResponse.json(
      { error: `Unexpected status ${status} after ${hops.length} hops. URL tail: ...${urlTail}. Body: ${text.slice(0, 200)}` },
      { status: 502 }
    );

  } catch (err) {
    console.error('[sheets proxy] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

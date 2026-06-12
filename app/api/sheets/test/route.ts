import { NextRequest, NextResponse } from 'next/server';

// GET /api/sheets/test?url=<encodedWebhookUrl>
// Returns full diagnostic info about what Google Apps Script returns
export async function GET(req: NextRequest) {
  const webhookUrl = req.nextUrl.searchParams.get('url');
  if (!webhookUrl) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 });
  }

  const testPayload = [{ gameId: 'test-connection', timestamp: new Date().toISOString() }];
  const diag: Record<string, unknown> = { webhookUrl, steps: [] };
  const steps = diag.steps as unknown[];

  try {
    // Step 1 — initial request
    const r1 = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(testPayload),
      redirect: 'manual',
    });

    steps.push({ step: 1, status: r1.status, location: r1.headers.get('location') });

    if (r1.status >= 300 && r1.status < 400) {
      const location = r1.headers.get('location');
      if (!location) {
        diag.result = 'redirect with no Location header';
        return NextResponse.json(diag);
      }

      // Step 2 — follow redirect with POST
      const r2 = await fetch(location, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(testPayload),
      });

      const text = await r2.text();
      steps.push({ step: 2, status: r2.status, body: text.slice(0, 500) });
      diag.finalStatus = r2.status;
      diag.finalBody = text.slice(0, 800);

      try {
        diag.parsed = JSON.parse(text);
      } catch {
        diag.parsed = null;
        diag.parseError = 'Response is not JSON';
      }
    } else {
      const text = await r1.text();
      steps.push({ step: '1-no-redirect', status: r1.status, body: text.slice(0, 500) });
      diag.finalStatus = r1.status;
      diag.finalBody = text.slice(0, 800);
      try { diag.parsed = JSON.parse(text); } catch { diag.parsed = null; }
    }
  } catch (err) {
    diag.fetchError = String(err);
  }

  return NextResponse.json(diag, { status: 200 });
}

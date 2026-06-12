import { NextRequest, NextResponse } from 'next/server';

// GET /api/sheets/test?url=<encodedWebhookUrl>
export async function GET(req: NextRequest) {
  const webhookUrl = req.nextUrl.searchParams.get('url');
  if (!webhookUrl) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 });
  }

  const testPayload = [{ gameId: 'test-connection', timestamp: new Date().toISOString() }];
  const bodyStr = JSON.stringify(testPayload);
  const hops: { url: string; status: number; location: string | null; bodySnippet: string }[] = [];
  let current = webhookUrl;

  for (let i = 0; i < 6; i++) {
    let res: Response;
    try {
      res = await fetch(current, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: bodyStr,
        redirect: 'manual',
      });
    } catch (err) {
      hops.push({ url: current, status: 0, location: null, bodySnippet: String(err) });
      break;
    }

    const location = res.headers.get('location');
    let bodySnippet = '';
    if (res.status < 300 || res.status >= 400) {
      bodySnippet = (await res.text()).slice(0, 300);
    }

    hops.push({ url: current, status: res.status, location, bodySnippet });

    if (res.status >= 300 && res.status < 400 && location) {
      current = location;
    } else {
      break;
    }
  }

  return NextResponse.json({ hops }, { status: 200 });
}

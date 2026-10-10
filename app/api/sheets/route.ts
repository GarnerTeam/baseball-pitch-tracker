import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { resolveScriptUrl, scriptPost, scriptErrorBody } from '@/lib/apps-script';

export async function POST(req: NextRequest) {
  try {
    // Every write is stamped with the AUTHENTICATED user's id, server-side —
    // never trust a client-supplied userId, or any user could write rows
    // under someone else's identity. This route is already behind Clerk's
    // middleware, so a missing session here means something is misconfigured.
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    // Pitches are tagged with BOTH the real creator (userId, for audit /
    // permissions / "who scored this") and the Organization scope
    // (organizationId, falling back to the personal userId for solo
    // coaches) that all batter-history and analytics queries key off of.
    const organizationId = orgId || userId;

    const { webhookUrl, pitches } = await req.json();

    if (!Array.isArray(pitches) || pitches.length === 0) {
      return NextResponse.json({ error: 'Missing pitches' }, { status: 400 });
    }
    const url = resolveScriptUrl(webhookUrl);

    // Spread client fields FIRST, then the server-derived identity, so a
    // client can never smuggle its own userId/organizationId (or a `_kind`
    // that reroutes the write) into the row.
    const stampedPitches = pitches.map((p: Record<string, unknown>) => {
      const { _kind, ...rest } = p ?? {};
      void _kind;
      return { ...rest, userId, organizationId };
    });
    const { status, text, hops } = await scriptPost(url, stampedPitches);

    console.log('[sheets proxy] hops:', hops, 'final status:', status);

    // 405 after execution is the normal Google Apps Script response —
    // doPost() ran and wrote the data; the response delivery channel
    // doesn't accept another POST, hence 405.
    if (status === 405) {
      return NextResponse.json({ synced: pitches.length });
    }

    // Successful JSON response from doPost
    if (status >= 200 && status < 300) {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(text); } catch { /* non-JSON 2xx — still success */ }
      if (body.status === 'error') {
        return NextResponse.json({ error: body.message }, { status: 500 });
      }
      return NextResponse.json({ synced: pitches.length });
    }

    // 0 = too many redirects, or any other unexpected status
    console.error('[sheets proxy] unexpected status', status, text.slice(0, 300));
    return NextResponse.json(
      { error: `Unexpected status ${status} after ${hops} hops: ${text.slice(0, 200)}` },
      { status: 502 }
    );

  } catch (err) {
    console.error('[sheets proxy] error:', err);
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

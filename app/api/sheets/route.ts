import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { scriptErrorBody } from '@/lib/apps-script';
import { db, mirror, mirrorToSheet, mode, sheetWrite, scriptUrlFor } from '@/lib/backend';
import { writePitches } from '@/lib/db/store';

/**
 * POST /api/sheets — the offline pitch queue syncs here.
 * Body: { webhookUrl, pitches: FlatPitch[] } (see lib/sheets.ts flattenPitch)
 *
 * Every row is stamped with the AUTHENTICATED user's id and organization,
 * server-side — never trust client-supplied identity. Where the rows go
 * depends on DATA_STORE (lib/db/client.ts): the Sheet, the Sheet + a
 * Postgres copy, or Postgres + a Sheet copy.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const organizationId = orgId || userId;

    const { webhookUrl, pitches } = await req.json();
    if (!Array.isArray(pitches) || pitches.length === 0) {
      return NextResponse.json({ error: 'Missing pitches' }, { status: 400 });
    }
    const url = scriptUrlFor(webhookUrl);

    // Client fields first, then server identity, so a client can never
    // smuggle its own userId/organizationId (or a `_kind` that reroutes the
    // write) into a row.
    const stamped = pitches.map((p: Record<string, unknown>) => {
      const { _kind, ...rest } = p ?? {};
      void _kind;
      return { ...rest, userId, organizationId };
    });

    if (mode() === 'database') {
      await writePitches(db(), stamped);
      mirrorToSheet('pitches', url, stamped);
      return NextResponse.json({ synced: pitches.length });
    }

    const r = await sheetWrite(url, stamped);
    if (!r.ok) {
      console.error('[sheets proxy] write failed:', r.error);
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    if (mode() === 'dual') {
      await mirror('pitches', () => writePitches(db(), stamped));
    }
    return NextResponse.json({ synced: pitches.length });
  } catch (err) {
    console.error('[sheets proxy] error:', err);
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

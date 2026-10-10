import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { resolveScriptUrl, scriptGet, scriptErrorBody } from '@/lib/apps-script';
import { getDb, dataStore } from '@/lib/db/client';
import { countsByScope, importSheetPage, isEditRow, legacyPitchId, type SheetExport } from '@/lib/db/store';
import { hasImportToken, isAdmin } from '@/lib/admin';

export const maxDuration = 60;

const PAGE = 2000;

/**
 * Access: a signed-in admin (see lib/admin.ts), or a request carrying the
 * one-time ADMIN_IMPORT_TOKEN as the `token` query parameter. This route is
 * excluded from the sign-in redirect in middleware.ts so the token path can
 * work; every request is still checked here.
 */
async function guard(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token');
  if (!hasImportToken(token)) {
    const { userId } = await auth();
    if (!userId) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
    if (!(await isAdmin(userId))) return { error: NextResponse.json({ error: 'Admins only', userId }, { status: 403 }) };
  }
  const db = getDb();
  if (!db) return { error: NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 503 }) };
  return { db };
}

/**
 * GET — what Postgres holds now, per organization.
 * GET ?run=1&offset=N — imports one page (same as POST), for token use.
 */
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const sp = new URL(req.url).searchParams;
  if (sp.get('run') === '1') return importPage(g.db, Number(sp.get('offset')) || 0);
  try {
    return NextResponse.json({ dataStore: dataStore(), ...(await countsByScope(g.db)) });
  } catch (err) {
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * POST { offset } — imports one page of the Sheet (Pitches rows
 * offset..offset+2000; the first page also brings Players and Rosters).
 * Safe to repeat: everything is upserted by id. The admin page calls this
 * in a loop until `done`.
 */
export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const { offset = 0 } = (await req.json().catch(() => ({}))) as { offset?: number };
  return importPage(g.db, Number(offset) || 0);
}

async function importPage(db: NonNullable<ReturnType<typeof getDb>>, offset: number) {
  try {
    const url = resolveScriptUrl();
    const page = (await scriptGet(url, { action: 'export', offset: String(offset), limit: String(PAGE) })) as SheetExport & {
      error?: string; total?: number;
    };
    if (page.error) return NextResponse.json({ error: page.error }, { status: 502 });

    // Per-organization tally of this page, to compare with Postgres at the end.
    // Counts distinct pitch ids: a retried sync can leave the same pitch on
    // two Sheet rows, but it is one row in Postgres.
    const seen: Record<string, Set<string>> = {};
    for (const r of page.pitches ?? []) {
      if (isEditRow(r) || !String(r.gameId ?? '').trim()) continue;
      const org = String(r.organizationId ?? '').trim();
      const key = org || `user:${String(r.userId ?? '').trim()}`;
      (seen[key] ??= new Set()).add(String(r.id ?? '').trim() || legacyPitchId(r));
    }
    const sheetByScope = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.size]));

    const imported = await importSheetPage(db, page);
    const received = page.pitches?.length ?? 0;
    const total = Number(page.total) || 0;
    const nextOffset = offset + received;
    return NextResponse.json({ offset, nextOffset, total, done: received === 0 || nextOffset >= total, imported, sheetByScope });
  } catch (err) {
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

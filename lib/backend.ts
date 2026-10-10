// Server-only: decides, per request, whether a read or write goes to the
// Google Sheet, to Postgres, or to both (see DATA_STORE in lib/db/client.ts).
import { after } from 'next/server';
import { scriptGet, scriptPost } from './apps-script';
import { dataStore, getDb, sheetsMirrorEnabled, type Db } from './db/client';
import * as store from './db/store';

export type Scope = store.Scope;

/** Result of a write to the Apps Script, with its redirect quirks decoded. */
export interface SheetWriteResult { ok: boolean; status: number; body: Record<string, unknown>; error?: string }

/**
 * POSTs to the Apps Script and interprets the reply. A 405 on the final
 * redirect hop means doPost() already ran (Google's delivery hop refuses
 * the repeated POST) — that's success with no readable body.
 */
export async function sheetWrite(url: string, payload: unknown): Promise<SheetWriteResult> {
  const { status, text } = await scriptPost(url, payload);
  if (status === 405) return { ok: true, status, body: {} };
  if (status >= 200 && status < 300) {
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* non-JSON 2xx — the write still ran */ }
    if (body.status === 'error') return { ok: false, status: 500, body, error: String(body.message ?? 'Apps Script error') };
    return { ok: true, status, body };
  }
  return { ok: false, status: 502, body: {}, error: `Unexpected status ${status}: ${text.slice(0, 200)}` };
}

export function mode() {
  return dataStore();
}

export function db(): Db {
  const d = getDb();
  if (!d) throw new Error('DATABASE_URL is not configured');
  return d;
}

/**
 * Copies a write to the secondary store without failing the request.
 * In "database" mode the Sheet copy runs after the response is sent; in
 * "dual" mode the Postgres copy is awaited (it's fast) but never throws.
 */
export async function mirror(label: string, fn: () => Promise<unknown>, background = false) {
  const run = async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[mirror] ${label} failed:`, err instanceof Error ? err.message : err);
    }
  };
  if (background) after(run);
  else await run();
}

/** Mirror a write to the Sheet in "database" mode (unless SHEETS_MIRROR=off). */
export function mirrorToSheet(label: string, url: string, payload: unknown) {
  if (!sheetsMirrorEnabled()) return;
  void mirror(label, async () => {
    const r = await sheetWrite(url, payload);
    if (!r.ok) throw new Error(r.error);
  }, true);
}

/** Run a read action against whichever store is primary. */
export async function readAction(
  url: string,
  action: 'history' | 'scout' | 'games' | 'roster' | 'players' | 'unlinkedBatters',
  scope: Scope,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  if (mode() !== 'database') {
    return scriptGet(url, { ...params, action, organizationId: scope.organizationId, userId: scope.userId });
  }
  const d = db();
  switch (action) {
    case 'history':
      return store.getBatterHistory(d, scope, { batterName: params.batter ?? '', batterNum: params.num ?? '', playerId: params.playerId ?? '' });
    case 'scout':
      return store.getGameScout(d, scope, params.gameId ?? '');
    case 'games':
      return store.getGamesList(d, scope);
    case 'roster':
      return store.getRoster(d, scope, params.team ?? '');
    case 'players':
      return store.getPlayersList(d, scope);
    case 'unlinkedBatters':
      return store.getUnlinkedBatters(d, scope);
  }
}

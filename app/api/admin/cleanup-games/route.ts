import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db/client';
import * as store from '@/lib/db/store';
import { hasImportToken, isAdmin } from '@/lib/admin';

/**
 * Removes test games: every game with at most `max` pitches (default 4).
 *
 *   GET  ?max=4         → list what would be deleted (changes nothing)
 *   POST ?max=4&confirm=<count> (or GET with &run=1&confirm=<count>) → delete them; `confirm` must equal the
 *        number of games the preview listed, so a game recorded in between
 *        can't be swept up. Returns the deleted pitches as a backup.
 *
 * Admin session or the one-time ADMIN_IMPORT_TOKEN (?token=) required.
 */
async function allowed(req: NextRequest) {
  if (hasImportToken(new URL(req.url).searchParams.get('token'))) return null;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(userId))) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  return null;
}

function maxOf(req: NextRequest) {
  const n = Number(new URL(req.url).searchParams.get('max') ?? 4);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

export async function GET(req: NextRequest) {
  const denied = await allowed(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 503 });
  const max = maxOf(req);
  if (!max) return NextResponse.json({ error: 'max must be 1–10' }, { status: 400 });
  if (new URL(req.url).searchParams.get('run') === '1') return runDelete(req);
  const games = await store.listSmallGames(db, max);
  return NextResponse.json({ max, count: games.length, pitches: games.reduce((n, g) => n + g.pitches, 0), games });
}

export async function POST(req: NextRequest) {
  return runDelete(req);
}

async function runDelete(req: NextRequest) {
  const denied = await allowed(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 503 });
  const max = maxOf(req);
  if (!max) return NextResponse.json({ error: 'max must be 1–10' }, { status: 400 });
  const games = await store.listSmallGames(db, max);
  const confirm = Number(new URL(req.url).searchParams.get('confirm'));
  if (confirm !== games.length) {
    return NextResponse.json({ error: `confirm must equal the ${games.length} games currently listed`, count: games.length }, { status: 409 });
  }
  const result = await store.deleteGames(db, games.map(g => g.gameId));
  return NextResponse.json({ deletedGames: games.length, deletedPitches: result.pitches.length, deletedSavedGames: result.savedGames, games, backup: result.pitches });
}

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db, mode } from '@/lib/backend';
import * as games from '@/lib/db/games';

/**
 * Saved games — what powers Resume Game and End Game.
 *
 *   GET  /api/games                 → { games }  games still in progress
 *   GET  /api/games?gameId=…        → { game }   one game with its snapshot (null if never saved)
 *   PUT  /api/games  { gameId, snapshot, status: 'active'|'final', reopen? }
 *        → { status, stale, storedPitches }
 *   POST /api/games  { action: 'end', gameId } → { ended }   end without a snapshot
 *
 * Signed-in only; everything is scoped to the caller's organization (or
 * their own account when they have none), never to client-supplied ids.
 */

const MAX_SNAPSHOT_BYTES = 3_000_000;

async function scope() {
  const { userId, orgId } = await auth();
  if (!userId) return null;
  return { organizationId: orgId || userId, userId };
}

function unavailable() {
  return NextResponse.json({ error: 'Saved games need the database, which is not switched on.' }, { status: 503 });
}

function fail(err: unknown) {
  console.error('[games] error:', err);
  return NextResponse.json({ error: 'Could not reach the database. Please try again.' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const s = await scope();
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (mode() !== 'database') return unavailable();
  try {
    const gameId = new URL(req.url).searchParams.get('gameId')?.trim();
    if (gameId) return NextResponse.json({ game: await games.getSavedGame(db(), s, gameId) });
    return NextResponse.json({ games: await games.listActiveGames(db(), s) });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: NextRequest) {
  const s = await scope();
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (mode() !== 'database') return unavailable();
  try {
    const text = await req.text();
    if (text.length > MAX_SNAPSHOT_BYTES) {
      return NextResponse.json({ error: 'Game is too large to save' }, { status: 413 });
    }
    const body = JSON.parse(text) as { gameId?: unknown; snapshot?: unknown; status?: unknown; reopen?: unknown };
    const gameId = typeof body.gameId === 'string' ? body.gameId.trim() : '';
    const snapshot = body.snapshot as Record<string, unknown> | null;
    const status = body.status === 'final' ? 'final' : body.status === 'active' ? 'active' : null;
    if (!gameId || !status || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
        || snapshot.id !== gameId || !Array.isArray(snapshot.lineup) || !Array.isArray(snapshot.allAtBats)) {
      return NextResponse.json({ error: 'Invalid game' }, { status: 400 });
    }
    const result = await games.saveGame(db(), s, { gameId, snapshot, status, reopen: body.reopen === true });
    const storedPitches = await games.storedPitchCount(db(), s, gameId);
    return NextResponse.json({ ...result, storedPitches });
  } catch (err) {
    if (err instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  const s = await scope();
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (mode() !== 'database') return unavailable();
  try {
    const body = await req.json().catch(() => ({})) as { action?: unknown; gameId?: unknown };
    const gameId = typeof body.gameId === 'string' ? body.gameId.trim() : '';
    if (body.action !== 'end' || !gameId) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    return NextResponse.json({ ended: await games.endGame(db(), s, gameId) });
  } catch (err) {
    return fail(err);
  }
}

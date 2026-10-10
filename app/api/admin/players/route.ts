import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db/client';
import { hasImportToken, isAdmin } from '@/lib/admin';

/**
 * GET /api/admin/players?name=… — admin lookup of every player record whose
 * name contains `name` (active or merged away), with how many pitches each
 * is linked to. For checking merges and duplicates.
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  if (!hasImportToken(sp.get('token'))) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!(await isAdmin(userId))) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 503 });
  const name = (sp.get('name') ?? '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const players = await db.query(
    `SELECT p.id, p.name, p.number, p.org_id, p.is_active, p.merged_into,
            (SELECT count(*)::int FROM pitches WHERE player_id = p.id) AS pitches,
            (SELECT array_agg(DISTINCT visiting_team) FROM pitches WHERE player_id = p.id) AS teams
     FROM players p WHERE p.name ILIKE '%' || $1 || '%' ORDER BY p.id`,
    [name],
  );
  const unlinked = await db.query(
    `SELECT batter_name, batter_number, visiting_team, count(*)::int AS pitches
     FROM pitches WHERE player_id = '' AND batter_name ILIKE '%' || $1 || '%'
     GROUP BY 1, 2, 3`,
    [name],
  );
  return NextResponse.json({ players, unlinkedPitches: unlinked });
}

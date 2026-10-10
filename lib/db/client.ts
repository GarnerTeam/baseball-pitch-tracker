// Server-only: Postgres access for API routes.
import { neon } from '@neondatabase/serverless';

/**
 * The tiny slice of a Postgres client the data layer needs. Production uses
 * Neon's HTTP driver; tests use an in-process PGlite. Keeping the surface
 * this small means every query in lib/db is plain parameterised SQL.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

let cached: Db | null | undefined;

/** Returns the database, or null when DATABASE_URL isn't configured. */
export function getDb(env: NodeJS.ProcessEnv = process.env): Db | null {
  if (cached !== undefined && env === process.env) return cached;
  const url = env.DATABASE_URL;
  const db: Db | null = url
    ? {
        async query<T>(text: string, params: unknown[] = []) {
          const sql = neon(url);
          return (await sql.query(text, params)) as T[];
        },
      }
    : null;
  if (env === process.env) cached = db;
  return db;
}

/**
 * Which store the app reads from and writes to. Set DATA_STORE in Vercel:
 *
 *   (unset) / "sheets" — Google Sheets only (current behaviour).
 *   "dual"             — Sheets stays primary for reads and writes; every
 *                        write is also copied to Postgres. Safe first step.
 *   "database"         — Postgres is primary for reads and writes; every
 *                        write is also copied to the Sheet.
 *
 * Set SHEETS_MIRROR=off (with "database") to stop copying to the Sheet.
 * Each step is undone by changing the variable back and redeploying.
 */
export type DataStore = 'sheets' | 'dual' | 'database';

export function dataStore(env: NodeJS.ProcessEnv = process.env): DataStore {
  const v = (env.DATA_STORE ?? '').trim().toLowerCase();
  if ((v === 'dual' || v === 'database') && env.DATABASE_URL) return v;
  return 'sheets';
}

export function sheetsMirrorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SHEETS_MIRROR ?? '').trim().toLowerCase() !== 'off';
}

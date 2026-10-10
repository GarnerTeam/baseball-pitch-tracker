// Applies db/migrations/*.sql in order, once each, recording them in
// schema_migrations. Used by `npm run db:migrate`, by production builds on
// Vercel (see package.json "build"), and by the tests.
//
//   node db/migrate.mjs            — migrate DATABASE_URL (no-op if unset)
//   node db/migrate.mjs --if-prod  — only when VERCEL_ENV=production
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Split a migration into statements (no function bodies in our SQL). */
export function splitStatements(sql) {
  return sql
    .split(/;\s*$/m)
    .map(s => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

/** @param {(text: string, params?: unknown[]) => Promise<unknown[]>} query */
export async function migrate(query, log = console.log) {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await query(`SELECT name FROM schema_migrations`)).map(r => r.name));
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    for (const stmt of splitStatements(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      await query(stmt);
    }
    await query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [f]);
    applied.push(f);
    log(`[db] applied ${f}`);
  }
  if (applied.length === 0) log('[db] schema is up to date');
  return applied;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const onlyProd = process.argv.includes('--if-prod');
  const url = process.env.DATABASE_URL;
  if (onlyProd && process.env.VERCEL_ENV !== 'production') {
    console.log('[db] skipping migrations (not a production build)');
  } else if (!url) {
    console.log('[db] DATABASE_URL not set — skipping migrations');
  } else {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    await migrate((text, params = []) => sql.query(text, params));
  }
}

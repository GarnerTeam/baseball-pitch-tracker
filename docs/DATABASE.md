# Postgres database

The app is moving its system of record from the Google Sheet to a Neon Postgres database on Vercel. The move happens in steps. Each step is turned on, or undone, by one environment variable.

## How it works

`DATA_STORE` (Vercel environment variable) decides where reads and writes go:

| `DATA_STORE` | Reads from | Writes to | Use it for |
| --- | --- | --- | --- |
| unset / `sheets` | Sheet | Sheet | Before the database exists (today) |
| `dual` | Sheet | Sheet, then a copy to Postgres | Filling Postgres while the Sheet stays in charge |
| `database` | Postgres | Postgres, then a copy to the Sheet | Postgres in charge; the Sheet becomes an export |

With `database`, set `SHEETS_MIRROR=off` to stop copying to the Sheet. If `DATABASE_URL` is missing, the app always falls back to the Sheet.

The API routes return the same JSON in every mode, so no screen changes.

- Code: `lib/db/` (schema access), `lib/backend.ts` (mode switching), `db/migrations/` (schema).
- Migrations run automatically on **production** builds (`node db/migrate.mjs --if-prod`). Run them by hand with `DATABASE_URL=… npm run db:migrate`.

## Tables

- **pitches** — one row per pitch, same fields as the Sheet's Pitches tab. Keyed by the app's pitch id, so a retried sync is a no-op.
- **players** — the `PLR####` player identities. Games, pitches and last-seen are computed live from `pitches`.
- **rosters** — saved opposing-team rosters, one row per (organization, player).

Every row carries `org_id` (Clerk organization, or the user id for solo coaches) and `user_id`. Rows recorded before organizations existed have an empty `org_id` and belong to the user who recorded them. These are the same rules the Sheet uses.

## Rollout

1. **Finish the security rollout first** (PR #11). The import needs the Apps Script shared secret (`API_SECRET` / `SHEETS_WEBHOOK_SECRET`) in place.
2. **Create the database.** In Vercel, open **Storage → Create Database → Neon**, name it `pitch-tracker`, and connect it to the **baseball-pitch-tracker** project for **Production only**. Preview deployments then keep using the Sheet, so testing a branch never writes to the real database.
3. **Update the Apps Script.** Paste the new `docs/apps-script.js`, then **Deploy → Manage deployments → Edit → New version**. This adds the export used by the import, and lets the Sheet keep Postgres's player ids.
4. **Turn on dual mode.** In Vercel → Settings → Environment Variables (Production), add `DATA_STORE` = `dual`. Merge this PR (or redeploy). The production build creates the tables.
5. **Make yourself an admin.** Open `/admin` while signed in. It shows your user id. Add it as `ADMIN_USER_IDS` in Vercel and redeploy.
6. **Import the history.** On `/admin`, press **Import from Sheet**. The table at the end compares unique pitches per organization in the Sheet and in Postgres. You can run it again at any time.
7. **Use the app for a few days in dual mode.** Then run the import once more and check the table matches.
8. **Switch Postgres on.** Set `DATA_STORE` = `database` and redeploy. To undo, set it back to `dual` and redeploy.
9. **Later:** once you're happy, set `SHEETS_MIRROR` = `off` to stop copying to the Sheet.

## Not yet

- Undoing a pitch that has already synced still leaves it in both stores (this was already true of the Sheet).
- Scout share links still use the `owner` id; signed, expiring links come next.
- A `games` table, which will hold game status, innings and the resume snapshot.

// Server-only: who may use the admin tools (Sheet → Postgres import).
// ADMIN_USER_IDS is a comma-separated list of Clerk user ids.
export function isAdmin(userId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!userId) return false;
  return (env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(userId);
}

// Server-only: who may use the admin tools (Sheet → Postgres import).
import { timingSafeEqual } from 'node:crypto';
import { clerkClient } from '@clerk/nextjs/server';

function list(v: string | undefined): string[] {
  return (v ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * An admin is a signed-in user whose Clerk user id is in ADMIN_USER_IDS, or
 * one of whose VERIFIED email addresses is in ADMIN_EMAILS (both
 * comma-separated Vercel environment variables).
 */
export async function isAdmin(userId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!userId) return false;
  if (list(env.ADMIN_USER_IDS).includes(userId.toLowerCase())) return true;
  const emails = list(env.ADMIN_EMAILS);
  if (emails.length === 0) return false;
  try {
    const user = await (await clerkClient()).users.getUser(userId);
    return user.emailAddresses.some(
      e => e.verification?.status === 'verified' && emails.includes(e.emailAddress.toLowerCase()),
    );
  } catch {
    return false;
  }
}

/**
 * A one-time key for running the Sheet import without a browser session
 * (ADMIN_IMPORT_TOKEN, at least 32 characters). Meant to be set for one
 * import and then removed or changed.
 */
export function hasImportToken(provided: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.ADMIN_IMPORT_TOKEN ?? '';
  if (expected.length < 32 || !provided) return false;
  const a = Buffer.from(expected), b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

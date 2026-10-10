import { describe, it, expect, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    users: {
      getUser: async (id: string) => ({
        emailAddresses: id === 'u_verified'
          ? [{ emailAddress: 'Coach@Example.com', verification: { status: 'verified' } }]
          : [{ emailAddress: 'coach@example.com', verification: { status: 'unverified' } }],
      }),
    },
  }),
}));

import { hasImportToken, isAdmin } from '@/lib/admin';

describe('admin access', () => {
  it('accepts listed user ids and verified listed emails only', async () => {
    const env = { ADMIN_USER_IDS: 'user_1', ADMIN_EMAILS: 'coach@example.com' } as NodeJS.ProcessEnv;
    expect(await isAdmin('user_1', env)).toBe(true);
    expect(await isAdmin('u_verified', env)).toBe(true);
    expect(await isAdmin('u_unverified', env)).toBe(false);
    expect(await isAdmin(null, env)).toBe(false);
    expect(await isAdmin('u_verified', {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('import token must be long and match exactly', () => {
    const t = 'x'.repeat(40);
    expect(hasImportToken(t, { ADMIN_IMPORT_TOKEN: t } as NodeJS.ProcessEnv)).toBe(true);
    expect(hasImportToken(t + 'y', { ADMIN_IMPORT_TOKEN: t } as NodeJS.ProcessEnv)).toBe(false);
    expect(hasImportToken('short', { ADMIN_IMPORT_TOKEN: 'short' } as NodeJS.ProcessEnv)).toBe(false);
    expect(hasImportToken(t, {} as NodeJS.ProcessEnv)).toBe(false);
  });
});

import { auth } from '@clerk/nextjs/server';
import { isAdmin } from '@/lib/admin';
import { ImportPanel } from './import-panel';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const { userId } = await auth();
  if (!(await isAdmin(userId))) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-200 p-6">
        <div className="max-w-xl mx-auto space-y-3">
          <h1 className="text-2xl font-bold">Admin</h1>
          <p className="text-slate-400">This page is for administrators.</p>
          {userId && (
            <p className="text-slate-500 text-sm">
              To grant access, add your user id <code className="text-slate-300">{userId}</code> to the{' '}
              <code className="text-slate-300">ADMIN_USER_IDS</code> environment variable in Vercel and redeploy.
            </p>
          )}
        </div>
      </main>
    );
  }
  return <ImportPanel />;
}

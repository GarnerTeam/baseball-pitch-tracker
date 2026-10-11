import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** GET /api/version — the deployed version, so open apps know to refresh. */
export function GET() {
  return NextResponse.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

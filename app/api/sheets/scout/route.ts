import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { resolveScriptUrl, scriptGet, scriptErrorBody } from '@/lib/apps-script';

/**
 * GET /api/sheets/scout?url=<webhookUrl>[&gameId=<id>][&owner=<userId>]
 * Proxies to Apps Script doGet(action=scout) which returns all pitches
 * for the latest game (or a specific gameId) — used by the Scout view AND
 * by the authenticated "Past Games" browser in the main app.
 *
 * Dual-mode auth: this route is public (unauthenticated Scout visitors have
 * no Clerk session), so it accepts an explicit `owner` param as the tenant
 * scope. BUT if a real Clerk session IS present (calls from the logged-in
 * main app), that always wins — a signed-in user can never override the
 * scope to read someone else's data by passing a different `owner`.
 *
 * The `url` param is only honoured if it is an allowlisted Apps Script
 * deployment (see lib/apps-script.ts).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const gameId = searchParams.get('gameId') ?? '';

  const { userId: sessionUserId, orgId: sessionOrgId } = await auth();
  const ownerParam = searchParams.get('owner') ?? '';
  const organizationId = sessionOrgId || sessionUserId || ownerParam;
  const userId = sessionUserId || ownerParam;

  if (!organizationId) {
    return NextResponse.json({ error: 'Missing owner — no session and no owner parameter provided' }, { status: 400 });
  }

  try {
    const url = resolveScriptUrl(searchParams.get('url'));
    const json = await scriptGet(url, { action: 'scout', gameId, organizationId, userId });
    return NextResponse.json(json);
  } catch (err) {
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

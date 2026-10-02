import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

/**
 * GET /api/sheets/games?url=<webhookUrl>
 * Proxies to Apps Script doGet(action=games) which scans the sheet and
 * returns a lightweight list of distinct completed games (gameId, teams,
 * date, pitch count) — powers the "Past Games" browser in the main app.
 *
 * This route is always authenticated (protected by middleware) — the userId
 * scoping every result comes from the Clerk session, never from the client.
 */
export async function GET(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // Player identity + historical data are scoped to the Clerk Organization
  // when the coach belongs to one, so every teammate/assistant coach in the
  // same org sees the same games list. Falls back to the personal userId
  // for solo coaches who have not set up an Organization yet.
  const organizationId = orgId || userId;

  const { searchParams } = new URL(req.url);
  const webhookUrl = searchParams.get("url");

  if (!webhookUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    const qs = new URLSearchParams({ action: "games", organizationId, userId });
    const res = await fetch(`${webhookUrl}?${qs.toString()}`, {
      method: "GET",
      redirect: "follow",
      headers: { "Cache-Control": "no-cache" },
    });

    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json(
        { error: `Apps Script returned non-JSON: ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

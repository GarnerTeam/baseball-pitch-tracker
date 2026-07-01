import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/sheets/games?url=<webhookUrl>
 * Proxies to Apps Script doGet(action=games) which scans the sheet and
 * returns a lightweight list of distinct completed games (gameId, teams,
 * date, pitch count) — powers the "Past Games" browser in the main app.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const webhookUrl = searchParams.get("url");

  if (!webhookUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    const qs = new URLSearchParams({ action: "games" });
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

// Server-only: imported by API routes, never by client components.

/**
 * Server-side gateway to the Google Apps Script backend.
 *
 * Every /api/sheets/* route goes through here so that:
 *
 *  1. The server only ever calls a known Apps Script deployment. The client
 *     still sends a `url` (it doubles as the app's "Sheets connected" flag),
 *     but it is only honoured when it matches an allowlisted URL — otherwise
 *     the request is refused. This closes the open-proxy / SSRF hole where
 *     any caller could make our server fetch an arbitrary URL.
 *
 *  2. Every call carries the shared secret (`SHEETS_WEBHOOK_SECRET`) as the
 *     `key` query parameter. The Apps Script checks it against its own
 *     Script Property `API_SECRET` and rejects calls without it, so knowing
 *     the public script URL is no longer enough to read or write data.
 *     The secret lives only in server env vars — never in the browser.
 *
 * Allowlist, in order: SHEETS_WEBHOOK_URL (server-only, preferred),
 * NEXT_PUBLIC_SHEETS_WEBHOOK_URL and NEXT_PUBLIC_SCOUT_WEBHOOK_URL (legacy,
 * kept so existing deployments keep working), plus any comma-separated
 * extras in SHEETS_WEBHOOK_URL_ALLOWLIST.
 */

const SCRIPT_URL_PREFIX = 'https://script.google.com/macros/s/';

export class ScriptUrlError extends Error {
  status = 400;
}

/** Uniform JSON error for a failed Apps Script call. */
export function scriptErrorBody(err: unknown): { body: { error: string }; status: number } {
  if (err instanceof ScriptUrlError) return { body: { error: err.message }, status: err.status };
  return { body: { error: String(err instanceof Error ? err.message : err) }, status: 500 };
}

function normalise(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function allowedScriptUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = [
    env.SHEETS_WEBHOOK_URL,
    env.NEXT_PUBLIC_SHEETS_WEBHOOK_URL,
    env.NEXT_PUBLIC_SCOUT_WEBHOOK_URL,
    ...(env.SHEETS_WEBHOOK_URL_ALLOWLIST ?? '').split(','),
  ];
  const out: string[] = [];
  for (const u of raw) {
    if (!u) continue;
    const n = normalise(u);
    if (n.startsWith(SCRIPT_URL_PREFIX) && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Returns the Apps Script URL this request may use. A missing client URL
 * falls back to the default deployment; a client URL that isn't on the
 * allowlist is refused rather than silently redirected, so a coach's data
 * never lands somewhere they didn't expect.
 */
export function resolveScriptUrl(clientUrl?: string | null, env: NodeJS.ProcessEnv = process.env): string {
  const allowed = allowedScriptUrls(env);
  if (allowed.length === 0) {
    throw new ScriptUrlError('The Google Sheets backend is not configured on the server (SHEETS_WEBHOOK_URL).');
  }
  if (!clientUrl || !clientUrl.trim()) return allowed[0];
  const n = normalise(clientUrl);
  if (allowed.includes(n)) return n;
  throw new ScriptUrlError(
    'This Google Sheets link is not recognised by the server. Re-save the default link in Settings, ' +
    'or ask the admin to add it to SHEETS_WEBHOOK_URL_ALLOWLIST.',
  );
}

function withKey(url: string, params: Record<string, string> = {}, env: NodeJS.ProcessEnv = process.env): string {
  const qs = new URLSearchParams(params);
  const secret = env.SHEETS_WEBHOOK_SECRET;
  if (secret) qs.set('key', secret);
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

/** GET an Apps Script action and parse its JSON reply. */
export async function scriptGet(url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(withKey(url, params), {
    method: 'GET',
    redirect: 'follow',
    headers: { 'Cache-Control': 'no-cache' },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned non-JSON: ${text.slice(0, 300)}`);
  }
}

/**
 * POST to the Apps Script, re-issuing the POST at every redirect hop.
 * Google's web-app endpoint answers with a 2-hop redirect chain and Node's
 * fetch would downgrade POST→GET on a 302, silently skipping doPost().
 * The secret rides on the first URL only — that's where doPost() runs.
 */
export async function scriptPost(
  url: string,
  body: unknown,
  maxHops = 5,
): Promise<{ status: number; text: string; hops: number }> {
  const payload = JSON.stringify(body);
  let current = withKey(url);
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(current, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
      redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) return { status: res.status, text: '', hops: i + 1 };
      current = next;
      continue;
    }
    return { status: res.status, text: await res.text(), hops: i + 1 };
  }
  return { status: 0, text: 'Too many redirects', hops: maxHops };
}

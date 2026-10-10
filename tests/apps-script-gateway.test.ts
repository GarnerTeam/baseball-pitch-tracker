import { describe, it, expect, vi, afterEach } from 'vitest';
import { allowedScriptUrls, resolveScriptUrl, scriptGet, scriptPost, ScriptUrlError } from '@/lib/apps-script';

const A = 'https://script.google.com/macros/s/AAA/exec';
const B = 'https://script.google.com/macros/s/BBB/exec';

describe('allowedScriptUrls', () => {
  it('collects server, legacy and extra URLs, de-duplicated', () => {
    const env = { SHEETS_WEBHOOK_URL: A, NEXT_PUBLIC_SHEETS_WEBHOOK_URL: A + '/', SHEETS_WEBHOOK_URL_ALLOWLIST: ` ${B} ,` } as NodeJS.ProcessEnv;
    expect(allowedScriptUrls(env)).toEqual([A, B]);
  });
  it('ignores anything that is not an Apps Script web-app URL', () => {
    const env = { SHEETS_WEBHOOK_URL: 'http://169.254.169.254/latest', SHEETS_WEBHOOK_URL_ALLOWLIST: 'https://evil.example/x' } as NodeJS.ProcessEnv;
    expect(allowedScriptUrls(env)).toEqual([]);
  });
});

describe('resolveScriptUrl', () => {
  const env = { SHEETS_WEBHOOK_URL: A, SHEETS_WEBHOOK_URL_ALLOWLIST: B } as NodeJS.ProcessEnv;
  it('falls back to the default deployment when the client sends none', () => {
    expect(resolveScriptUrl(undefined, env)).toBe(A);
    expect(resolveScriptUrl('  ', env)).toBe(A);
  });
  it('accepts an allowlisted client URL', () => {
    expect(resolveScriptUrl(B, env)).toBe(B);
  });
  it('refuses any other URL (no open proxy)', () => {
    expect(() => resolveScriptUrl('https://internal.example/admin', env)).toThrow(ScriptUrlError);
    expect(() => resolveScriptUrl('https://script.google.com/macros/s/OTHER/exec', env)).toThrow(ScriptUrlError);
  });
  it('fails clearly when the server has no backend configured', () => {
    expect(() => resolveScriptUrl(A, {} as NodeJS.ProcessEnv)).toThrow(/not configured/);
  });
});

describe('secret is attached server-side', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('adds ?key= to GET calls', async () => {
    vi.stubEnv('SHEETS_WEBHOOK_SECRET', 's3cret');
    const fetchMock = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    await scriptGet(A, { action: 'games', organizationId: 'org_1' });
    const called = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(called.searchParams.get('key')).toBe('s3cret');
    expect(called.searchParams.get('organizationId')).toBe('org_1');
  });

  it('adds ?key= to the first POST hop only and follows redirects as POST', async () => {
    vi.stubEnv('SHEETS_WEBHOOK_SECRET', 's3cret');
    const hop2 = 'https://script.googleusercontent.com/macros/echo?x=1';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: hop2 } }))
      .mockResolvedValueOnce(new Response('{"status":"ok"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await scriptPost(A, [{ id: 'p1' }]);
    expect(r.status).toBe(200);
    expect(r.hops).toBe(2);
    const [u1, o1] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [u2, o2] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(new URL(u1).searchParams.get('key')).toBe('s3cret');
    expect(u2).toBe(hop2);
    expect(o1.method).toBe('POST');
    expect(o2.method).toBe('POST');
  });
});

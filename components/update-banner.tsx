'use client';
import { useEffect, useState } from 'react';

const MINE = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';

/**
 * A home-screen app can keep running yesterday's version for days. This
 * checks for a newer deploy when the app comes back to the foreground (and
 * every 10 minutes) and offers a one-tap update. Game data is safe: it's
 * kept on the device and in the cloud, so reloading loses nothing.
 */
export function UpdateBanner() {
  const [newer, setNewer] = useState(false);

  useEffect(() => {
    if (MINE === 'dev') return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = await res.json();
        if (!stopped && version && version !== 'dev' && version !== MINE) setNewer(true);
      } catch { /* offline — try again later */ }
    };
    check();
    const t = setInterval(check, 10 * 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  if (!newer) return null;
  return (
    <button
      onClick={() => window.location.reload()}
      className="fixed left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-full bg-emerald-600 text-white text-[16px] font-bold shadow-lg shadow-black/50 border border-emerald-400 whitespace-nowrap"
      style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      ✨ New version ready — tap to update
    </button>
  );
}

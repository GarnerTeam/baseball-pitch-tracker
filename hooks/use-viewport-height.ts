'use client';
import { useEffect } from 'react';

/**
 * Keeps the `--app-vh` CSS variable (see app/globals.css) in sync with the
 * REAL live viewport, using the VisualViewport API when available.
 *
 * Why this exists: `100dvh` alone should track mobile browser chrome
 * (address bar, bottom toolbar) as it shows/hides, but WebKit has a known
 * lag applying that recalculation right after an in-app (SPA) screen swap
 * rather than a full page navigation — e.g. tapping from the Past Games
 * list into a specific game. During that lag, a fixed full-screen
 * container sized purely with `100dvh` can end up measured against a
 * stale (larger) viewport, so its header/nav controls render underneath
 * the browser's own still-animating chrome — real estate the page
 * doesn't own, which silently swallows touches before they reach any
 * on-page element (matching: back button unresponsive, bottom nav tabs
 * unresponsive, but the actual scrollable middle content still works).
 *
 * Mount this ONCE at the app root. It only ever WRITES the CSS variable;
 * consuming components opt in via the `.h-app` utility class.
 */
export function useViewportHeight() {
  useEffect(() => {
    const root = document.documentElement;

    function setAppVh() {
      const vv = window.visualViewport;
      const h = vv ? vv.height : window.innerHeight;
      root.style.setProperty('--app-vh', `${h}px`);
    }

    setAppVh();

    // visualViewport fires resize/scroll as the browser's own chrome
    // animates in/out — these are the exact moments 100dvh can lag.
    window.visualViewport?.addEventListener('resize', setAppVh);
    window.visualViewport?.addEventListener('scroll', setAppVh);
    window.addEventListener('resize', setAppVh);
    window.addEventListener('orientationchange', setAppVh);

    return () => {
      window.visualViewport?.removeEventListener('resize', setAppVh);
      window.visualViewport?.removeEventListener('scroll', setAppVh);
      window.removeEventListener('resize', setAppVh);
      window.removeEventListener('orientationchange', setAppVh);
    };
  }, []);
}

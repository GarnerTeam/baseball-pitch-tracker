import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/scout(.*)',               // read-only scout view page
  '/api/sheets/scout(.*)',   // scout data API (called by unauthenticated scout page)
  '/api/sheets/history(.*)', // history API (called by batter history modal on scout page)
]);

export default clerkMiddleware(async (auth, req) => {
  const { pathname } = new URL(req.url);
  const host = req.headers.get('host') ?? '';

  // If the request arrives on the scout subdomain but isn't already
  // on /scout (or its API routes), redirect to /scout so the domain
  // works without needing /scout in the shared URL.
  if (
    host.startsWith('scout.') &&
    !pathname.startsWith('/scout') &&
    !pathname.startsWith('/api/sheets/scout') &&
    !pathname.startsWith('/api/sheets/history') &&
    !pathname.startsWith('/_next')
  ) {
    // Preserve the query string (url + owner) — a bare `new URL('/scout', req.url)`
    // silently drops it, which broke every Scout QR/link that pointed at the
    // bare domain root instead of /scout directly.
    const redirectUrl = new URL('/scout', req.url);
    redirectUrl.search = new URL(req.url).search;
    return NextResponse.redirect(redirectUrl);
  }

  if (!isPublicRoute(req)) {
    const { userId } = await auth();
    if (!userId) {
      const signInUrl = new URL('/sign-in', req.url);
      signInUrl.searchParams.set('redirect_url', req.url);
      return NextResponse.redirect(signInUrl);
    }
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};

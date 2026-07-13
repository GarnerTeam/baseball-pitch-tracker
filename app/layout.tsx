import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: '⚾ On the Bump',
  description: "Coach's in-game pitch tracker",
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'On the Bump',
  },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,   // allow up to 5× pinch-to-zoom
  userScalable: true,
  themeColor: '#020617',
  // Lets the app draw under the notch/home-indicator safe areas so we can
  // pad them ourselves — combined with the `h-dvh` fix on the app shell,
  // this keeps controls reachable both in standalone (home-screen) mode
  // and inside a regular mobile browser's UI chrome (address bar, nav bar).
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <head>
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        </head>
        <body className="bg-slate-950 min-h-screen antialiased">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Baked into the browser bundle so an open app can tell when a newer
  // version has been deployed (see components/update-banner.tsx).
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
  },
};

module.exports = nextConfig;

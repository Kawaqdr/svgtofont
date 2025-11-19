/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // For Next.js 14 – tell it not to bundle these into server components/route handlers
    serverComponentsExternalPackages: ["fantasticon", "ttf2woff2"]
  }
};

export default nextConfig;

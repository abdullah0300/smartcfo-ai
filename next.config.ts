import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  images: {
    remotePatterns: [
      {
        hostname: "avatar.vercel.sh",
      },
      {
        protocol: "https",
        //https://nextjs.org/docs/messages/next-image-unconfigured-host
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
  // Allow iframe embedding from main SaaS domain
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://smartcfo.webcraftio.com https://*.webcraftio.com http://localhost:* http://127.0.0.1:*",
          },
          {
            key: "X-Frame-Options",
            value: "ALLOW-FROM https://smartcfo.webcraftio.com",
          },
          {
            key: "Access-Control-Allow-Origin",
            value: "https://smartcfo.webcraftio.com",
          },
          {
            key: "Access-Control-Allow-Credentials",
            value: "true",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

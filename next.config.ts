import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Upload de criativos (ate 2 MB) passa por Server Action.
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;

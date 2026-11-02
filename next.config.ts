import type { NextConfig } from "next";

// Cabecalhos de seguranca para todas as rotas. Sem CSP de scripts: os slots de
// AdSense/MGID carregam scripts dos provedores; a politica de scripts entra quando
// as contas forem aprovadas e os dominios conhecidos (ver docs/LAUNCH-CHECKLIST.md).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Upload de criativos (ate 2 MB) passa por Server Action.
    serverActions: { bodySizeLimit: "3mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Painel, login e APIs fora dos buscadores; portal, sitemap, robots e ads.txt indexaveis.
      {
        source: "/((?!portal|sitemap\\.xml|robots\\.txt|ads\\.txt|opengraph-image).*)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;

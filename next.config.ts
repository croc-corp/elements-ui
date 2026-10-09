import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const withMDX = createMDX();

const security = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // no script-src: the theme script and JSON-LD are inline, and a nonce would make every page dynamic
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
];

const config: NextConfig = {
  // self-contained server in .next/standalone for the Docker image
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // files read at request time, which the tracer cannot see in the code
  outputFileTracingIncludes: {
    "/r/[name]": ["./.registry/r/**"],
    "/source/[...path]": ["./registry/**"],
    "/md/[[...slug]]": ["./content/**"],
  },
  async rewrites() {
    // "View as Markdown": every page has a .md twin
    return [
      { source: "/docs.md", destination: "/md/docs" },
      { source: "/docs/:path*.md", destination: "/md/docs/:path*" },
      { source: "/components.md", destination: "/md/components" },
      { source: "/components/:path*.md", destination: "/md/components/:path*" },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: security },
      {
        source: "/cdn/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
};

export default withMDX(config);

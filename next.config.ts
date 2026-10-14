import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The system prompt is read from disk at runtime, so ship it with the chat function.
  outputFileTracingIncludes: { "/api/chat": ["./prompts/**/*"] },
  poweredByHeader: false,
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // No site may frame the app or a poll page (stops clickjacking the vote button). A full CSP
          // is left out on purpose: Next inlines scripts, and a wrong policy breaks the app silently.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

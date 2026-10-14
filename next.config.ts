import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The system prompt is read from disk at runtime, so ship it with the chat function.
  outputFileTracingIncludes: { "/api/chat": ["./prompts/**/*"] },
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

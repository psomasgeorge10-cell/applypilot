import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Both database drivers are native/WASM Node packages: PGlite ships a .wasm
  // payload and node-postgres resolves optional native bindings at runtime.
  // Bundling either one breaks those lookups, so they are required at runtime
  // from node_modules instead.
  // playwright-core likewise locates browser binaries relative to itself.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "playwright-core"],

  // Do not emit AGENTS.md / CLAUDE.md into the repository.
  agentRules: false,

  // The Docker build sets BUILD_STANDALONE=true to emit .next/standalone: a
  // self-contained server carrying only the modules the app actually reached.
  // It is opt-in because `next start` does not serve that output - the image
  // runs `node server.js` directly instead.
  output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined,
};

export default nextConfig;

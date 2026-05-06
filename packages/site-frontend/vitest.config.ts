// vitest config — Solid component tests via @solidjs/testing-library + jsdom.
// Pure-function tests (renderers, contract) don't need jsdom and run faster
// in node, but co-locating them under the same vitest run keeps the workspace
// `bun --filter '*' test` story uniform.

import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "jsdom",
    globals: false,
    include: ["test/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
  },
  resolve: {
    // vite-plugin-solid's default conditions break under vitest unless we
    // pin the dev/development conditions ourselves.
    conditions: ["development", "browser"],
  },
});

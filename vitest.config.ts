import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The Chromia module's own unit suite.
 *
 * The ERP's tests run on `node --test` (tests/*.test.ts) and stay that way —
 * `npm test` is untouched. The 26 suites the Chromia module brought with it are
 * written for vitest and cover its business rules: disposition and quality
 * decisions, the recalibration flow and its five-attempt ceiling, slab filters,
 * the register parser, the export sheets, the production summary. Rewriting 724
 * assertions into another runner's dialect would risk the very rules they
 * protect, so they are kept as they are and run with `npm run test:chromia`.
 *
 * vitest is a devDependency only — nothing here ships.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/chromia/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});

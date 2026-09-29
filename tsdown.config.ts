import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

/**
 * Keep the built package entry points explicit so workspace-only modules do not become public API.
 */
export default defineConfig({
  entry: {
    index: "packages/core/src/index.ts",
    cli: "packages/cli/src/main.ts",
    mcp: "packages/mcp/src/public.ts",
  },
  platform: "node",
  target: "node22",
  format: "esm",
  dts: true,
  sourcemap: false,
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  clean: true,
  deps: { alwaysBundle: [/^@meuhedet\//] },
  hooks: {
    // The CLI entry is a bin, not an importable module, so its empty declaration file is removed.
    "build:done": async () => {
      await rm(fileURLToPath(new URL("dist/cli.d.ts", import.meta.url)), { force: true });
    },
  },
});

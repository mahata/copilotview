import { defineConfig } from "vitest/config";

/**
 * Vite's bundled list of Node builtins predates `node:sqlite`, so the import is
 * otherwise rewritten to a bare `sqlite` package and fails to resolve.
 */
function externalNodeSqlite() {
  return {
    name: "external-node-sqlite",
    enforce: "pre" as const,
    resolveId(id: string) {
      if (id === "node:sqlite" || id === "sqlite") {
        return { id: "node:sqlite", external: true };
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [externalNodeSqlite()],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});

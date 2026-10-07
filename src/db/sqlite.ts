import { createRequire } from "node:module";

/**
 * `node:sqlite` is loaded through `createRequire` on purpose: bundlers that
 * predate the module (Vite 6, esbuild) rewrite a static `node:sqlite` import to
 * a bare `sqlite` specifier and fail to resolve it.
 */
const nodeRequire = createRequire(import.meta.url);
const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");

export const { DatabaseSync } = sqlite;
export type Database = import("node:sqlite").DatabaseSync;
export type Statement = import("node:sqlite").StatementSync;

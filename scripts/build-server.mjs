import { build } from "esbuild";

// Bundled CommonJS dependencies (yaml, hono) call `require`, which an ESM
// bundle lacks; recreate it from the output file's own URL.
const banner = `#!/usr/bin/env node
import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
`;

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/cli.js",
  banner: { js: banner },
  logLevel: "info",
});

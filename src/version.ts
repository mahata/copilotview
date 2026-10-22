import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UNPACKAGED_BUILD_VERSION = "0.0.0-dev";

/** Release tarballs record their version in a VERSION file next to the bundled CLI. */
export function readVersion(cliDirectory = path.dirname(fileURLToPath(import.meta.url))): string {
  const versionFile = path.join(cliDirectory, "VERSION");
  if (!fs.existsSync(versionFile)) return UNPACKAGED_BUILD_VERSION;
  return fs.readFileSync(versionFile, "utf8").trim();
}

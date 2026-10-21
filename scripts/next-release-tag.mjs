import fs from "node:fs";

// Reads git tags, one per line, and prints the tag for the minor version after the latest vX.Y.Z tag
// as a GitHub Actions step output.
const versions = fs
  .readFileSync(0, "utf8")
  .split("\n")
  .map((line) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(line.trim()))
  .filter((match) => match !== null)
  .map((match) => match.slice(1).map(Number))
  .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

const latest = versions.at(-1);
const nextTag = latest === undefined ? "v0.1.0" : `v${latest[0]}.${latest[1] + 1}.0`;
process.stdout.write(`tag=${nextTag}\n`);

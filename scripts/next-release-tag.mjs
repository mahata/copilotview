import fs from "node:fs";

// Reads git tags, one per line, and prints the latest vX.Y.Z tag and the tag for the next minor
// version as GitHub Actions step outputs.
const versions = fs
  .readFileSync(0, "utf8")
  .split("\n")
  .map((line) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(line.trim()))
  .filter((match) => match !== null)
  .map((match) => match.slice(1).map(Number))
  .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

const latest = versions.at(-1);
const previousTag = latest === undefined ? "" : `v${latest.join(".")}`;
const nextTag = latest === undefined ? "v0.1.0" : `v${latest[0]}.${latest[1] + 1}.0`;
process.stdout.write(`previous-tag=${previousTag}\ntag=${nextTag}\n`);

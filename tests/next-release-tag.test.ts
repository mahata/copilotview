import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const nextReleaseTagScript = path.resolve("scripts/next-release-tag.mjs");

function nextReleaseTag(tags: string[]) {
  const result = spawnSync(process.execPath, [nextReleaseTagScript], {
    input: tags.map((tag) => `${tag}\n`).join(""),
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe("next-release-tag script", () => {
  it("bumps the minor version of the latest tag and resets the patch version", () => {
    expect(nextReleaseTag(["v0.1.0", "v1.2.3"])).toBe("previous-tag=v1.2.3\ntag=v1.3.0\n");
  });

  it("compares versions numerically rather than alphabetically", () => {
    expect(nextReleaseTag(["v0.9.0", "v0.10.0", "v0.2.0"])).toBe("previous-tag=v0.10.0\ntag=v0.11.0\n");
  });

  it("ignores tags that are not plain vX.Y.Z versions", () => {
    expect(nextReleaseTag(["v1.0.0", "v2.0.0-rc.1", "release-3", "v3.0"])).toBe(
      "previous-tag=v1.0.0\ntag=v1.1.0\n",
    );
  });

  it("starts at v0.1.0 when there are no version tags", () => {
    expect(nextReleaseTag([])).toBe("previous-tag=\ntag=v0.1.0\n");
  });
});

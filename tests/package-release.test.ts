import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const packageReleaseScript = path.resolve("scripts/package-release.mjs");

function runPackageRelease(projectDir: string, releaseTag?: string) {
  return spawnSync(process.execPath, [packageReleaseScript], {
    cwd: projectDir,
    env: { ...process.env, RELEASE_TAG: releaseTag },
    encoding: "utf8",
  });
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe("package-release script", () => {
  let projectDir: string;
  let releaseDir: string;
  let tarballPath: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilotview-release-"));
    releaseDir = path.join(projectDir, "release");
    tarballPath = path.join(releaseDir, "copilotview-1.2.3.tar.gz");
    writeFile(path.join(projectDir, "package.json"), JSON.stringify({ name: "copilotview", version: "1.2.3" }));
    writeFile(path.join(projectDir, "LICENSE"), "MIT License\n");
    writeFile(path.join(projectDir, "README.md"), "# copilotview\n");
    writeFile(path.join(projectDir, "dist", "cli.js"), "#!/usr/bin/env node\n");
    writeFile(path.join(projectDir, "dist", "web", "index.html"), "<!doctype html>\n");
    writeFile(path.join(projectDir, "dist", "web", "assets", "index.js"), "export {};\n");
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("archives the bundled CLI, web UI, version file, license and readme under a versioned directory", () => {
    const result = runPackageRelease(projectDir);

    expect(result.status, result.stderr).toBe(0);
    const archivedFiles = execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8" })
      .split("\n")
      .filter((entry) => entry !== "" && !entry.endsWith("/"));
    expect(archivedFiles.sort()).toEqual([
      "copilotview-1.2.3/LICENSE",
      "copilotview-1.2.3/README.md",
      "copilotview-1.2.3/VERSION",
      "copilotview-1.2.3/cli.js",
      "copilotview-1.2.3/web/assets/index.js",
      "copilotview-1.2.3/web/index.html",
    ]);
  });

  it("records the release version next to the CLI for copilotview --version", () => {
    const result = runPackageRelease(projectDir, "v2.0.0");

    expect(result.status, result.stderr).toBe(0);
    const recordedVersion = execFileSync(
      "tar",
      ["-xzOf", path.join(releaseDir, "copilotview-2.0.0.tar.gz"), "copilotview-2.0.0/VERSION"],
      { encoding: "utf8" },
    );
    expect(recordedVersion).toBe("2.0.0\n");
  });

  it("writes a sha256sum-compatible checksum next to the tarball", () => {
    runPackageRelease(projectDir);

    const expectedDigest = createHash("sha256").update(fs.readFileSync(tarballPath)).digest("hex");
    expect(fs.readFileSync(`${tarballPath}.sha256`, "utf8")).toBe(`${expectedDigest}  copilotview-1.2.3.tar.gz\n`);
  });

  it("leaves only the tarball and its checksum in the release directory", () => {
    runPackageRelease(projectDir);

    expect(fs.readdirSync(releaseDir).sort()).toEqual(["copilotview-1.2.3.tar.gz", "copilotview-1.2.3.tar.gz.sha256"]);
  });

  it("replaces artifacts left over from a previous run", () => {
    writeFile(path.join(releaseDir, "copilotview-1.2.2.tar.gz"), "stale");

    runPackageRelease(projectDir);

    expect(fs.existsSync(path.join(releaseDir, "copilotview-1.2.2.tar.gz"))).toBe(false);
  });

  it("names the tarball and its directory after the release tag rather than the package version", () => {
    const result = runPackageRelease(projectDir, "v2.0.0");

    expect(result.status, result.stderr).toBe(0);
    expect(fs.readdirSync(releaseDir).sort()).toEqual(["copilotview-2.0.0.tar.gz", "copilotview-2.0.0.tar.gz.sha256"]);
    const archivedEntries = execFileSync("tar", ["-tzf", path.join(releaseDir, "copilotview-2.0.0.tar.gz")], {
      encoding: "utf8",
    });
    expect(archivedEntries).toContain("copilotview-2.0.0/cli.js");
  });

  it.each(["1.2.3", "v1.2", "v1.2.3-rc.1"])("rejects the release tag %s", (releaseTag) => {
    const result = runPackageRelease(projectDir, releaseTag);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(releaseTag);
    expect(fs.existsSync(releaseDir)).toBe(false);
  });

  it("refuses to package before the web UI has been built", () => {
    fs.rmSync(path.join(projectDir, "dist", "web"), { recursive: true });

    const result = runPackageRelease(projectDir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("pnpm build");
    expect(fs.existsSync(releaseDir)).toBe(false);
  });
});

import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const homebrewFormulaScript = path.resolve("scripts/homebrew-formula.mjs");
const sha256 = "0123456789abcdef".repeat(4);

function renderFormula(...args: string[]) {
  return spawnSync(process.execPath, [homebrewFormulaScript, ...args], { encoding: "utf8" });
}

describe("homebrew-formula script", () => {
  it("points the formula at the release tarball and its checksum", () => {
    const result = renderFormula("1.2.3", sha256);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      'url "https://github.com/mahata/copilotview/releases/download/v1.2.3/copilotview-1.2.3.tar.gz"',
    );
    expect(result.stdout).toContain(`sha256 "${sha256}"`);
  });

  it("installs the version file that copilotview --version reads next to the CLI", () => {
    const result = renderFormula("1.2.3", sha256);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('libexec.install "cli.js", "web", "VERSION"');
  });

  it("tests that the installed CLI reports the formula's version", () => {
    const result = renderFormula("1.2.3", sha256);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('assert_match version.to_s, shell_output("#{bin}/copilotview --version")');
  });

  it.each(["v1.2.3", "1.2", "1.2.3-beta.1"])("rejects the version %s", (version) => {
    const result = renderFormula(version, sha256);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(version);
    expect(result.stdout).toBe("");
  });

  it.each(["0123abcd", sha256.toUpperCase(), `${sha256}  copilotview-1.2.3.tar.gz`])(
    "rejects the checksum %s",
    (checksum) => {
      const result = renderFormula("1.2.3", checksum);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("sha256");
      expect(result.stdout).toBe("");
    },
  );

  it("prints usage when arguments are missing", () => {
    const result = renderFormula("1.2.3");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("usage:");
  });
});

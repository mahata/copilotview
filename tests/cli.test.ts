import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cliEntryPoint = path.resolve("src/cli.ts");

function runCli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntryPoint, ...args], { encoding: "utf8" });
}

describe("copilotview CLI", () => {
  it.each(["version", "--version"])("prints the name and version of copilotview for %s", (argument) => {
    const result = runCli(argument);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("copilotview 0.0.0-dev\n");
  });

  it("lists the version command in its help", () => {
    const result = runCli("--help");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("copilotview version");
  });

  it("tells users in its help that cv is a shorter alias", () => {
    const result = runCli("--help");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("cv is a shorter alias for copilotview");
  });
});

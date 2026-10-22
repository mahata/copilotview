import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readVersion } from "../src/version";

describe("readVersion", () => {
  let cliDirectory: string;

  beforeEach(() => {
    cliDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilotview-version-"));
  });

  afterEach(() => {
    fs.rmSync(cliDirectory, { recursive: true, force: true });
  });

  it("reads the version that the release recorded next to the CLI", () => {
    fs.writeFileSync(path.join(cliDirectory, "VERSION"), "1.2.3\n");

    expect(readVersion(cliDirectory)).toBe("1.2.3");
  });

  it("reports a development version when no release version was recorded", () => {
    expect(readVersion(cliDirectory)).toBe("0.0.0-dev");
  });
});

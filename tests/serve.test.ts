import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openIndex } from "../src/db/schema";
import { indexSessions } from "../src/indexer/scan";

const cliEntryPoint = path.resolve("src/cli.ts");

interface RunningServer {
  url: string;
  stderr: () => string;
}

function writeSession(sessionStateDir: string, id: string) {
  const sessionDir = path.join(sessionStateDir, id);
  fs.mkdirSync(sessionDir, { recursive: true });
  const userMessage = { type: "user.message", timestamp: "2026-10-01T00:00:00.000Z", data: { content: "hello" } };
  fs.writeFileSync(path.join(sessionDir, "events.jsonl"), `${JSON.stringify(userMessage)}\n`);
}

async function fetchSessionCount(server: RunningServer): Promise<number> {
  const response = await fetch(`${server.url}/api/stats`);
  const stats = (await response.json()) as { sessionCount: number };
  return stats.sessionCount;
}

function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

describe("serve command", () => {
  let workDir: string;
  let sessionStateDir: string;
  let indexPath: string;
  const serverProcesses: ChildProcessWithoutNullStreams[] = [];

  function startServe(...args: string[]): Promise<RunningServer> {
    const serverProcess = spawn(process.execPath, ["--import", "tsx", cliEntryPoint, "serve", "--port", "0", ...args]);
    serverProcesses.push(serverProcess);
    serverProcess.stdout.setEncoding("utf8");
    serverProcess.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    serverProcess.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    return new Promise((resolve, reject) => {
      serverProcess.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        const url = /serving \d+ sessions on (http:\/\/\S+)/.exec(stdout)?.[1];
        if (url) resolve({ url, stderr: () => stderr });
      });
      serverProcess.once("exit", (code) => reject(new Error(`serve exited with code ${code}\n${stderr}`)));
    });
  }

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilotview-serve-"));
    sessionStateDir = path.join(workDir, "session-state");
    indexPath = path.join(workDir, "index.db");
    writeSession(sessionStateDir, "aaaa");
  });

  afterEach(async () => {
    await Promise.all(serverProcesses.splice(0).map(stopProcess));
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("indexes the session-state directory before serving", async () => {
    const server = await startServe("--source", sessionStateDir, "--index", indexPath);

    expect(await fetchSessionCount(server)).toBe(1);
  });

  it("keeps serving the existing index with a warning when the session-state directory is missing", async () => {
    const db = openIndex(indexPath);
    await indexSessions(db, sessionStateDir);
    db.close();
    const missingSessionStateDir = path.join(workDir, "missing");

    const server = await startServe("--source", missingSessionStateDir, "--index", indexPath);

    expect(await fetchSessionCount(server)).toBe(1);
    expect(server.stderr()).toContain(missingSessionStateDir);
  });
});

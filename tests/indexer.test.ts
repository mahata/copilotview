import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db/sqlite";
import { openIndex } from "../src/db/schema";
import { getSession, getStats, getTimeline, listSessions, search } from "../src/db/query";
import { indexSessions } from "../src/indexer/scan";

function jsonl(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

function makeSession(root: string, id: string, options: { repository: string; branch: string; content: string }) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "workspace.yaml"),
    [
      `id: ${id}`,
      `repository: ${options.repository}`,
      `branch: ${options.branch}`,
      "host_type: github",
      "cwd: /w",
      `name: Session ${id}`,
      `summary: Session ${id} summary`,
      "created_at: 2026-05-08T13:04:03.603Z",
      "updated_at: 2026-05-08T13:12:15.726Z",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "events.jsonl"),
    jsonl(
      {
        type: "session.start",
        timestamp: "2026-05-08T13:04:03.622Z",
        data: { sessionId: id, copilotVersion: "1.0.43", selectedModel: "claude-opus-5", context: { cwd: "/w" } },
      },
      { type: "user.message", timestamp: "2026-05-08T13:04:05.366Z", data: { content: options.content } },
      {
        type: "user.message",
        timestamp: "2026-05-08T13:04:05.400Z",
        data: { content: "injected skill preamble", source: "skill-workiq" },
      },
      {
        type: "assistant.message",
        timestamp: "2026-05-08T13:04:11.064Z",
        data: { content: "承知しました。実装します。", model: "claude-opus-5" },
      },
      {
        type: "tool.execution_start",
        timestamp: "2026-05-08T13:04:11.066Z",
        data: { toolCallId: "t1", toolName: "edit", arguments: { path: "/w/src/main.ts" } },
      },
      { type: "tool.execution_complete", timestamp: "2026-05-08T13:04:11.1Z", data: { toolCallId: "t1", success: true } },
      {
        type: "session.task_complete",
        timestamp: "2026-05-08T13:12:15.726Z",
        data: { summary: "## 完了\nグラフ描画を実装しました。", success: true },
      },
    ),
  );
  const checkpoints = path.join(dir, "checkpoints");
  fs.mkdirSync(checkpoints, { recursive: true });
  fs.writeFileSync(
    path.join(checkpoints, "index.md"),
    "| # | Title | File |\n|---|---|---|\n| 1 | First checkpoint | 001-first.md\n".replace(
      "001-first.md",
      "001-first.md |",
    ),
  );
  fs.writeFileSync(path.join(checkpoints, "001-first.md"), "<overview>\nチェックポイントの概要\n</overview>\n");
  return dir;
}

describe("indexer end to end", () => {
  let root: string;
  let db: Database;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "copilotview-test-"));
    makeSession(root, "aaaa", { repository: "acme/demo", branch: "main", content: "グラフ描画を実装してください" });
    makeSession(root, "bbbb", { repository: "acme/other", branch: "dev", content: "Fix the flaky test runner for 𠮷野" });
    fs.mkdirSync(path.join(root, "empty-session"), { recursive: true });
    db = openIndex(":memory:");
    await indexSessions(db, root);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("skips directories without an event log", () => {
    expect(listSessions(db).total).toBe(2);
  });

  it("stores workspace metadata and derived counts", () => {
    const detail = getSession(db, "aaaa");
    expect(detail?.session).toMatchObject({
      repository: "acme/demo",
      branch: "main",
      name: "Session aaaa",
      userMessageCount: 1,
      assistantMessageCount: 1,
      toolCallCount: 1,
      fileCount: 1,
      copilotVersion: "1.0.43",
    });
    expect(detail?.session.models).toEqual(["claude-opus-5"]);
  });

  it("collects task_complete summaries and checkpoints as artifacts", () => {
    const kinds = getSession(db, "aaaa")?.artifacts.map((a) => a.kind).sort();
    expect(kinds).toEqual(["checkpoint", "task_complete"]);
  });

  it("finds Japanese text with the trigram tokenizer", () => {
    const result = search(db, "グラフ描画");
    expect(result.total).toBeGreaterThan(0);
    expect(result.hits[0]!.session.id).toBe("aaaa");
    expect(result.hits.some((h) => h.snippet.ranges.length > 0)).toBe(true);
  });

  it("finds ASCII text case-insensitively", () => {
    expect(search(db, "FLAKY").hits[0]?.session.id).toBe("bbbb");
  });

  it("matches terms too short for the trigram index with a LIKE fallback", () => {
    const result = search(db, "実装");
    expect(result.fallbackTerms).toEqual(["実装"]);
    expect(result.hits.map((h) => h.session.id)).toContain("aaaa");
  });

  it("counts Unicode code points when selecting the LIKE fallback", () => {
    const result = search(db, "𠮷野");
    expect(result.fallbackTerms).toEqual(["𠮷野"]);
    expect(result.hits.map((h) => h.session.id)).toContain("bbbb");
  });

  it("matches and highlights artifact titles", () => {
    const checkpointIndex = path.join(root, "aaaa", "checkpoints", "index.md");
    fs.writeFileSync(
      checkpointIndex,
      "| # | Title | File |\n|---|---|---|\n| 1 | 題名 | 001-first.md |\n",
    );
    return indexSessions(db, root).then(() => {
      const result = search(db, "題名", { scope: "artifact" });
      expect(result.fallbackTerms).toEqual(["題名"]);
      expect(result.hits[0]?.snippet.ranges.length).toBeGreaterThan(0);
    });
  });

  it("combines indexed and fallback terms with AND", () => {
    expect(search(db, "グラフ描画 実装").total).toBeGreaterThan(0);
    expect(search(db, "グラフ描画 検出").total).toBe(0);
  });

  it("restricts scope to genuine user prompts", () => {
    const result = search(db, "injected skill preamble", { scope: "user" });
    expect(result.total).toBe(0);
    expect(search(db, "injected skill preamble", { scope: "all" }).total).toBeGreaterThan(0);
  });

  it("searches touched file paths", () => {
    const result = search(db, "src/main.ts", { scope: "file" });
    expect(result.hits.map((h) => h.session.id).sort()).toEqual(["aaaa", "bbbb"]);
  });

  it("filters by repository", () => {
    expect(listSessions(db, { repository: "acme/other" }).sessions.map((s) => s.id)).toEqual(["bbbb"]);
  });

  it("interleaves messages and tool calls in the timeline", () => {
    const timeline = getTimeline(db, "aaaa");
    expect(timeline.map((e) => e.kind)).toEqual(["message", "message", "tool"]);
  });

  it("hides injected messages from the timeline by default", () => {
    expect(getTimeline(db, "aaaa").filter((e) => e.kind === "message" && e.source !== null)).toHaveLength(0);
    expect(
      getTimeline(db, "aaaa", { includeInjected: true }).filter((e) => e.kind === "message" && e.source !== null),
    ).toHaveLength(1);
  });

  it("aggregates stats", () => {
    const stats = getStats(db);
    expect(stats.sessionCount).toBe(2);
    expect(stats.models).toEqual([{ model: "claude-opus-5", count: 2 }]);
    expect(stats.tools).toEqual([{ toolName: "edit", count: 2, failures: 0 }]);
    expect(stats.monthly).toEqual([{ month: "2026-05", count: 2 }]);
  });

  it("refreshes when non-event inputs change", async () => {
    const workspace = path.join(root, "aaaa", "workspace.yaml");
    fs.appendFileSync(workspace, "summary: Updated metadata\n");
    const result = await indexSessions(db, root);
    expect(result).toMatchObject({ indexed: 1, skipped: 1 });
  });

  it("skips unchanged sessions and prunes deleted sessions during a forced run", async () => {
    const second = await indexSessions(db, root);
    expect(second).toMatchObject({ indexed: 0, skipped: 2, removed: 0 });

    fs.rmSync(path.join(root, "bbbb"), { recursive: true, force: true });
    const third = await indexSessions(db, root, { force: true });
    expect(third).toMatchObject({ indexed: 1, skipped: 0, removed: 1 });
    expect(listSessions(db).total).toBe(1);
    expect(search(db, "flaky").total).toBe(0);
  });
});

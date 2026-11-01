import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/sqlite";
import { openDatabase, openIndex } from "../src/db/schema";
import { getSession, getStats, getTimeline, listSessions, search, type SearchResult } from "../src/db/query";
import { indexSessions } from "../src/indexer/scan";
import { createApp } from "../src/server/app";

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
    expect(stats.messageCount).toBe(4);
    expect(stats.toolCallCount).toBe(2);
    expect(stats.models).toEqual([{ model: "claude-opus-5", count: 2 }]);
    expect(stats.tools).toEqual([{ toolName: "edit", count: 2, failures: 0, medianDurationMs: 34 }]);
    expect(stats.monthly).toEqual([{ month: "2026-05", count: 2 }]);
  });

  it("reports no usage or code changes for sessions that recorded none", () => {
    expect(getSession(db, "aaaa")).toMatchObject({
      usage: {
        total: { requests: 0, aiCredits: 0, requestsWithoutAiCredits: 0, inputTokens: 0, outputTokens: 0 },
        byModel: [],
        unrecordedRuns: 0,
      },
      codeChanges: null,
    });
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

describe("full re-index", () => {
  let root: string;
  let db: Database;

  function triggers(target: Database = db): string[] {
    const rows = target.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
    return (rows as { name: string }[]).map((r) => r.name);
  }

  /** Throws when a full-text index has drifted from the table it indexes. */
  function checkFullTextIndexes(): void {
    db.exec("INSERT INTO messages_fts(messages_fts, rank) VALUES ('integrity-check', 1)");
    db.exec("INSERT INTO artifacts_fts(artifacts_fts, rank) VALUES ('integrity-check', 1)");
  }

  function interrupt(): never {
    throw new Error("interrupted");
  }

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "copilotview-reindex-test-"));
    makeSession(root, "aaaa", { repository: "acme/demo", branch: "main", content: "グラフ描画を実装してください" });
    makeSession(root, "bbbb", { repository: "acme/other", branch: "dev", content: "Fix the flaky test runner" });
    db = openIndex(":memory:");
    await indexSessions(db, root);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("builds the full-text indexes and restores the triggers that keep them in step", () => {
    expect(triggers()).toEqual(["artifacts_fts_ad", "artifacts_fts_ai", "messages_fts_ad", "messages_fts_ai"]);
    checkFullTextIndexes();
    expect(search(db, "flaky").total).toBe(1);
  });

  it("keeps the full-text indexes in step through later incremental updates", async () => {
    makeSession(root, "bbbb", { repository: "acme/other", branch: "dev", content: "Speed up the indexer" });
    expect(await indexSessions(db, root)).toMatchObject({ indexed: 1, skipped: 1 });
    expect(search(db, "flaky").total).toBe(0);
    expect(search(db, "indexer").total).toBe(1);
    checkFullTextIndexes();
  });

  it("replaces the full-text indexes on a forced run", async () => {
    fs.rmSync(path.join(root, "bbbb"), { recursive: true });
    expect(await indexSessions(db, root, { force: true })).toMatchObject({ indexed: 1, removed: 1 });
    expect(search(db, "flaky").total).toBe(0);
    expect(search(db, "グラフ描画").total).toBeGreaterThan(0);
    expect(triggers()).toHaveLength(4);
    checkFullTextIndexes();
  });

  it("leaves the previous index as it was when a forced run fails", async () => {
    fs.rmSync(path.join(root, "bbbb"), { recursive: true });
    await expect(indexSessions(db, root, { force: true, onProgress: interrupt })).rejects.toThrow("interrupted");
    expect(listSessions(db).total).toBe(2);
    expect(search(db, "flaky").total).toBe(1);
    expect(triggers()).toHaveLength(4);
    checkFullTextIndexes();
  });

  it("leaves a new index empty when its first build fails", async () => {
    const fresh = openIndex(":memory:");
    try {
      await expect(indexSessions(fresh, root, { onProgress: interrupt })).rejects.toThrow("interrupted");
      expect(listSessions(fresh).total).toBe(0);
      expect(triggers(fresh)).toHaveLength(4);
    } finally {
      fresh.close();
    }
  });

  it("truncates the write-ahead log it grew", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "copilotview-wal-test-"));
    const file = path.join(dir, "index.db");
    const fileDb = openIndex(file);
    try {
      await indexSessions(fileDb, root);
      expect(fs.statSync(`${file}-wal`).size).toBe(0);
    } finally {
      fileDb.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("period filter", () => {
  const beforeLastUpdate = "2026-09-15T00:00:00.000Z";
  const afterLastUpdate = "2026-10-15T00:00:00.000Z";
  let root: string;
  let db: Database;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "copilotview-period-test-"));
    const dir = path.join(root, "resumed");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "workspace.yaml"),
      "id: resumed\nrepository: acme/zoo\nbranch: main\nupdated_at: 2026-10-01T00:00:00.000Z\n",
    );
    fs.writeFileSync(
      path.join(dir, "events.jsonl"),
      jsonl(
        {
          type: "session.start",
          timestamp: "2026-09-01T00:00:00.000Z",
          data: { sessionId: "resumed", selectedModel: "claude-opus-5" },
        },
        { type: "user.message", timestamp: "2026-09-01T00:00:00.000Z", data: { content: "zebra early" } },
        {
          type: "tool.execution_start",
          timestamp: "2026-09-01T00:00:00.000Z",
          data: { toolCallId: "t0", toolName: "bash", arguments: { command: "ls" } },
        },
        { type: "user.message", data: { content: "zebra undated" } },
        {
          type: "tool.execution_start",
          timestamp: "2026-10-20T00:00:00.000Z",
          data: { toolCallId: "t1", toolName: "edit", arguments: { path: "/w/zebra.ts" } },
        },
        { type: "user.message", timestamp: "2026-10-20T00:00:00.000Z", data: { content: "zebra late" } },
        {
          type: "session.task_complete",
          timestamp: "2026-10-20T00:00:00.000Z",
          data: { summary: "zebra report", success: true },
        },
      ),
    );
    db = openIndex(":memory:");
    await indexSessions(db, root);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function matchedUserMessages(period: { from?: string; to?: string }): string[] {
    return search(db, "zebra", { scope: "user", ...period })
      .hits.map((hit) => hit.snippet.text)
      .sort();
  }

  it("judges message hits by when the message was sent", () => {
    expect(matchedUserMessages({ from: afterLastUpdate })).toEqual(["zebra late"]);
    expect(matchedUserMessages({ from: beforeLastUpdate })).not.toContain("zebra early");
    expect(matchedUserMessages({ to: beforeLastUpdate })).toEqual(["zebra early"]);
  });

  it("falls back to the session's last update for messages without a timestamp", () => {
    expect(matchedUserMessages({ from: beforeLastUpdate })).toContain("zebra undated");
    expect(matchedUserMessages({ from: afterLastUpdate })).not.toContain("zebra undated");
  });

  it("judges plan, summary, and file name hits by the session's last update", () => {
    for (const scope of ["artifact", "file"] as const) {
      expect(search(db, "zebra", { scope, from: beforeLastUpdate }).total).toBe(1);
      expect(search(db, "zebra", { scope, from: afterLastUpdate }).total).toBe(0);
    }
  });

  it("judges the session list by the session's last update", () => {
    expect(listSessions(db, { from: beforeLastUpdate }).total).toBe(1);
    expect(listSessions(db, { from: afterLastUpdate }).total).toBe(0);
  });

  it("judges session statistics by the session's last update", () => {
    const included = getStats(db, { from: beforeLastUpdate });
    expect(included).toMatchObject({
      sessionCount: 1,
      repositories: [{ repository: "acme/zoo", count: 1 }],
      models: [{ model: "claude-opus-5", count: 1 }],
      branches: [{ branch: "main", count: 1 }],
      monthly: [{ month: "2026-09", count: 1 }],
    });
    expect(included.indexedBytes).toBeGreaterThan(0);

    expect(getStats(db, { from: afterLastUpdate })).toMatchObject({
      sessionCount: 0,
      indexedBytes: 0,
      repositories: [],
      models: [],
      branches: [],
      monthly: [],
    });
  });

  it("counts messages in statistics by when they were sent", () => {
    expect(getStats(db, { from: afterLastUpdate }).messageCount).toBe(1);
    expect(getStats(db, { to: beforeLastUpdate }).messageCount).toBe(1);
  });

  it("counts undated messages in statistics by the session's last update", () => {
    expect(getStats(db, { from: beforeLastUpdate }).messageCount).toBe(2);
  });

  it("counts tool calls in statistics by when they were made", () => {
    expect(getStats(db, { from: beforeLastUpdate })).toMatchObject({
      toolCallCount: 1,
      tools: [{ toolName: "edit", count: 1, failures: 0 }],
    });
    expect(getStats(db, { from: afterLastUpdate })).toMatchObject({
      toolCallCount: 1,
      tools: [{ toolName: "edit", count: 1, failures: 0 }],
    });
    expect(getStats(db, { to: beforeLastUpdate })).toMatchObject({
      toolCallCount: 1,
      tools: [{ toolName: "bash", count: 1, failures: 0 }],
    });
  });

  it("serves statistics for the requested period", async () => {
    const response = await createApp(db).request(`/api/stats?from=${afterLastUpdate}`);
    expect(await response.json()).toMatchObject({ sessionCount: 0, messageCount: 1, toolCallCount: 1 });
  });

  it("serves sessions, matches, and statistics between both ends of a period", async () => {
    const app = createApp(db);
    const period = `from=${beforeLastUpdate}&to=${afterLastUpdate}`;

    expect(await (await app.request(`/api/sessions?${period}`)).json()).toMatchObject({ total: 1 });
    const matches = (await (await app.request(`/api/search?q=zebra&scope=user&${period}`)).json()) as SearchResult;
    expect(matches.hits.map((hit) => hit.snippet.text)).toEqual(["zebra undated"]);
    expect(await (await app.request(`/api/stats?${period}`)).json()).toMatchObject({
      sessionCount: 1,
      messageCount: 1,
      toolCallCount: 0,
    });
  });
});

function toolCall(id: string, toolName: string, startedAt: string, completedAt: string): unknown[] {
  return [
    { type: "tool.execution_start", timestamp: startedAt, data: { toolCallId: id, toolName, arguments: {} } },
    { type: "tool.execution_complete", timestamp: completedAt, data: { toolCallId: id, success: true } },
  ];
}

function usageRecord(timestamp: string, credits: number): unknown {
  return {
    type: "session.usage_record",
    timestamp,
    data: {
      usage: {
        model: "claude-opus-5.5",
        initiator: "agent",
        cost: 15,
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 60,
        cacheWriteTokens: 30,
        copilotUsage: { totalNanoAiu: credits * 1e9 },
      },
    },
  };
}

describe("usage statistics", () => {
  const october = "2026-10-01T00:00:00.000Z";
  const endOfSeptember = "2026-09-30T23:59:59.999Z";
  let root: string;
  let db: Database;

  function writeSession(id: string, updatedAt: string, events: unknown[]): void {
    const dir = path.join(root, id);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "workspace.yaml"), `id: ${id}\nupdated_at: ${updatedAt}\n`);
    fs.writeFileSync(path.join(dir, "events.jsonl"), jsonl(...events));
  }

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "copilotview-usage-test-"));
    writeSession("records", "2026-10-20T00:00:00.000Z", [
      { type: "session.start", timestamp: "2026-09-01T00:00:00.000Z", data: { sessionId: "records" } },
      { type: "assistant.turn_start", data: {} },
      usageRecord("2026-09-01T00:01:00.000Z", 15),
      ...toolCall("b1", "bash", "2026-09-01T00:02:00.000Z", "2026-09-01T00:02:00.010Z"),
      ...toolCall("b2", "bash", "2026-09-01T00:03:00.000Z", "2026-09-01T00:03:00.020Z"),
      ...toolCall("b3", "bash", "2026-09-01T00:04:00.000Z", "2026-09-01T00:04:01.000Z"),
      { type: "assistant.turn_start", data: {} },
      usageRecord("2026-10-10T00:00:00.000Z", 2),
      {
        type: "session.compaction_complete",
        timestamp: "2026-10-10T00:30:00.000Z",
        data: {
          compactionTokensUsed: { model: "claude-opus-5.5", copilotUsage: { totalNanoAiu: 0.5 * 1e9 } },
        },
      },
      {
        type: "session.shutdown",
        timestamp: "2026-10-10T01:00:00.000Z",
        data: {
          codeChanges: { linesAdded: 30, linesRemoved: 5 },
          modelMetrics: {
            "claude-opus-5.5": {
              requests: { count: 2, cost: 15 },
              totalNanoAiu: 17.5 * 1e9,
              usage: { inputTokens: 200 },
            },
          },
        },
      },
    ]);
    writeSession("shutdowns", "2026-10-05T00:00:00.000Z", [
      { type: "session.start", timestamp: "2026-09-02T00:00:00.000Z", data: { sessionId: "shutdowns" } },
      { type: "assistant.turn_start", data: {} },
      { type: "session.resume", timestamp: "2026-09-03T00:00:00.000Z", data: {} },
      { type: "assistant.turn_start", data: {} },
      { type: "assistant.turn_start", data: {} },
      ...toolCall("v1", "view", "2026-09-03T00:01:00.000Z", "2026-09-03T00:01:00.010Z"),
      ...toolCall("v2", "view", "2026-09-03T00:02:00.000Z", "2026-09-03T00:02:00.020Z"),
      {
        type: "session.shutdown",
        timestamp: "2026-09-03T01:00:00.000Z",
        data: {
          codeChanges: { linesAdded: 7, linesRemoved: 1 },
          modelMetrics: {
            "gpt-5.5": { requests: { count: 2, cost: 2 }, usage: { inputTokens: 40, outputTokens: 4 } },
          },
        },
      },
    ]);
    db = openIndex(":memory:");
    await indexSessions(db, root);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("totals usage, code changes, and sessions with usage left out", () => {
    expect(getStats(db)).toMatchObject({
      usage: {
        requests: 4,
        aiCredits: 17.5,
        requestsWithoutAiCredits: 2,
        inputTokens: 240,
        outputTokens: 24,
        cacheReadTokens: 120,
        cacheWriteTokens: 60,
      },
      usageByModel: [
        { model: "claude-opus-5.5", requests: 2, aiCredits: 17.5, requestsWithoutAiCredits: 0 },
        { model: "gpt-5.5", requests: 2, aiCredits: null, requestsWithoutAiCredits: 2 },
      ],
      codeChanges: { linesAdded: 37, linesRemoved: 6 },
      sessionsWithUnrecordedUsage: 1,
      sessionsWithoutAiCredits: 1,
    });
  });

  it("reports the median duration of each tool", () => {
    expect(getStats(db).tools).toEqual([
      { toolName: "bash", count: 3, failures: 0, medianDurationMs: 20 },
      { toolName: "view", count: 2, failures: 0, medianDurationMs: 15 },
    ]);
  });

  it("counts usage, and sessions with usage recorded without AI credits, by when it was recorded", () => {
    expect(getStats(db, { from: october })).toMatchObject({
      usage: { requests: 1, aiCredits: 2.5, requestsWithoutAiCredits: 0 },
      usageByModel: [{ model: "claude-opus-5.5", requests: 1, aiCredits: 2.5 }],
      sessionsWithoutAiCredits: 0,
    });
    expect(getStats(db, { to: endOfSeptember })).toMatchObject({
      usage: { requests: 3, aiCredits: 15, requestsWithoutAiCredits: 2 },
      usageByModel: [
        { model: "claude-opus-5.5", requests: 1, aiCredits: 15 },
        { model: "gpt-5.5", requests: 2, aiCredits: null },
      ],
      sessionsWithoutAiCredits: 1,
    });
  });

  it("counts code changes and unrecorded usage by the session's last update", () => {
    expect(getStats(db, { from: october })).toMatchObject({
      codeChanges: { linesAdded: 37, linesRemoved: 6 },
      sessionsWithUnrecordedUsage: 1,
    });
    expect(getStats(db, { to: endOfSeptember })).toMatchObject({
      codeChanges: { linesAdded: 0, linesRemoved: 0 },
      sessionsWithUnrecordedUsage: 0,
    });
  });

  it("breaks down a session's usage by model", () => {
    expect(getSession(db, "records")).toMatchObject({
      usage: {
        total: {
          requests: 2,
          aiCredits: 17.5,
          requestsWithoutAiCredits: 0,
          inputTokens: 200,
          outputTokens: 20,
          cacheReadTokens: 120,
        },
        byModel: [{ model: "claude-opus-5.5", requests: 2, aiCredits: 17.5 }],
        unrecordedRuns: 0,
      },
      codeChanges: { linesAdded: 30, linesRemoved: 5 },
    });
    expect(getSession(db, "shutdowns")).toMatchObject({
      usage: { total: { requests: 2, aiCredits: null, requestsWithoutAiCredits: 2 }, unrecordedRuns: 1 },
      codeChanges: { linesAdded: 7, linesRemoved: 1 },
    });
  });

  it("serves usage with statistics and session details", async () => {
    const app = createApp(db);
    expect(await (await app.request(`/api/stats?from=${october}`)).json()).toMatchObject({
      usage: { requests: 1, aiCredits: 2.5 },
      sessionsWithUnrecordedUsage: 1,
      sessionsWithoutAiCredits: 0,
    });
    expect(await (await app.request("/api/sessions/shutdowns")).json()).toMatchObject({
      usage: { total: { aiCredits: null }, unrecordedRuns: 1 },
      codeChanges: { linesAdded: 7 },
    });
  });
});

describe("schema migration", () => {
  it("rebuilds an index created with an older schema", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "copilotview-migrate-test-"));
    try {
      const file = path.join(dir, "index.db");
      const old = openDatabase(file);
      old.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO meta (key, value) VALUES ('schema_version', '2');
        CREATE TABLE tool_calls (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER NOT NULL,
          tool_name TEXT NOT NULL, target TEXT, success INTEGER, timestamp TEXT);
      `);
      old.close();

      const db = openIndex(file);
      const columns = (db.prepare("SELECT name FROM pragma_table_info('tool_calls')").all() as { name: string }[]).map(
        (c) => c.name,
      );
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (t) => t.name,
      );
      db.close();
      expect(columns).toContain("duration_ms");
      expect(tables).toEqual(expect.arrayContaining(["model_usage", "activity_slots"]));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

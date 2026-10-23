import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEventsFile, parseEventsText } from "../src/indexer/events";

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

/** Writes an event the way the CLI does: `type`, `data`, `id`, `timestamp`, then `parentId`. */
function cliLine(type: string, timestamp: string, data: unknown = {}, parentId: string | null = null): string {
  return JSON.stringify({ type, data, id: "0b9e1f7a-4c1d-4f3e-9a51-6d2c8e7b5a10", timestamp, parentId });
}

const LOG = [
  line({
    type: "session.start",
    timestamp: "2026-05-08T13:04:03.622Z",
    data: {
      sessionId: "s1",
      copilotVersion: "1.0.43",
      selectedModel: "claude-opus-4.7",
      context: {
        cwd: "/w",
        gitRoot: "/w",
        branch: "feature/ci",
        repository: "acme/demo",
        hostType: "github",
        headCommit: "f85138f",
      },
    },
  }),
  line({
    type: "user.message",
    timestamp: "2026-05-08T13:04:05.366Z",
    data: {
      content: "CI を実装してください",
      transformedContent: "<meta/>CI を実装してください",
      agentMode: "plan",
      parentAgentTaskId: "abd30f34-08fe-43d1-9314-b003867863e4",
    },
  }),
  "{ this is not json",
  line({
    type: "user.message",
    timestamp: "2026-05-08T13:04:06.000Z",
    data: { content: "<skill-context>...</skill-context>", source: "skill-workiq" },
  }),
  line({
    type: "assistant.message",
    timestamp: "2026-05-08T13:04:11.064Z",
    data: { content: "", model: "claude-opus-4.7", toolRequests: [{ toolCallId: "t1", name: "edit" }] },
  }),
  line({
    type: "tool.execution_start",
    timestamp: "2026-05-08T13:04:11.066Z",
    data: { toolCallId: "t1", toolName: "edit", arguments: { path: "/w/.github/workflows/ci.yml" } },
  }),
  line({
    type: "tool.execution_complete",
    timestamp: "2026-05-08T13:04:11.114Z",
    data: { toolCallId: "t1", success: true },
  }),
  line({
    type: "tool.execution_start",
    timestamp: "2026-05-08T13:04:12.000Z",
    data: { toolCallId: "t2", toolName: "bash", arguments: { command: "pytest -q\nsecond line" } },
  }),
  line({
    type: "tool.execution_complete",
    timestamp: "2026-05-08T13:04:13.000Z",
    data: { toolCallId: "t2", success: false },
  }),
  line({
    type: "assistant.message",
    timestamp: "2026-05-08T13:04:20.000Z",
    data: { content: "subagent output", model: "gpt-5.5", parentToolCallId: "t9" },
  }),
  line({
    type: "session.task_complete",
    timestamp: "2026-05-08T13:12:15.726Z",
    data: { summary: "## 実装完了\nCI を追加しました。", success: true },
  }),
  "",
].join("\n");

describe("parseEventsText", () => {
  const parsed = parseEventsText(LOG);

  it("skips malformed lines but keeps counting them", () => {
    expect(parsed.malformedLines).toBe(1);
  });

  it("keeps the raw user content, not the transformed prompt", () => {
    expect(parsed.messages[0]).toMatchObject({
      role: "user",
      content: "CI を実装してください",
      agentMode: "plan",
      source: null,
    });
  });

  it("records the injected origin of non-human user messages", () => {
    expect(parsed.messages[1]!.source).toBe("skill-workiq");
  });

  it("does not treat parentAgentTaskId on a user message as a subagent marker", () => {
    expect(parsed.messages[0]!.isSubagent).toBe(false);
    expect(parsed.messages[1]!.isSubagent).toBe(false);
  });

  it("drops assistant messages that carry only tool requests", () => {
    const assistant = parsed.messages.filter((m) => m.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toMatchObject({ content: "subagent output", isSubagent: true, model: "gpt-5.5" });
  });

  it("joins tool completion results back onto their start event", () => {
    expect(parsed.toolCalls).toMatchObject([
      { toolName: "edit", target: "/w/.github/workflows/ci.yml", success: 1, durationMs: 48 },
      { toolName: "bash", target: "pytest -q", success: 0, durationMs: 1000 },
    ]);
  });

  it("collects touched files from path-bearing tool arguments", () => {
    expect(parsed.files).toEqual([{ path: "/w/.github/workflows/ci.yml", toolName: "edit" }]);
  });

  it("collects every model used in the session", () => {
    expect(parsed.models).toEqual(["claude-opus-4.7", "gpt-5.5"]);
  });

  it("captures the completion summary as an artifact", () => {
    expect(parsed.artifacts).toEqual([
      { kind: "task_complete", ordinal: 0, title: null, body: "## 実装完了\nCI を追加しました。" },
    ]);
  });

  it("derives the time range and session context", () => {
    expect(parsed.startedAt).toBe("2026-05-08T13:04:03.622Z");
    expect(parsed.endedAt).toBe("2026-05-08T13:12:15.726Z");
    expect(parsed.context).toMatchObject({ repository: "acme/demo", branch: "feature/ci" });
    expect(parsed.copilotVersion).toBe("1.0.43");
  });

  it("reports no usage or code changes when the CLI recorded none", () => {
    expect(parsed).toMatchObject({ usage: [], unrecordedRuns: 0, linesAdded: null, linesRemoved: null });
  });
});

describe("tool durations", () => {
  it("leaves the duration unknown when either end has no timestamp", () => {
    const parsed = parseEventsText(
      [
        line({ type: "tool.execution_start", data: { toolCallId: "t1", toolName: "view", arguments: {} } }),
        line({
          type: "tool.execution_complete",
          timestamp: "2026-05-08T13:04:13.000Z",
          data: { toolCallId: "t1", success: true },
        }),
      ].join("\n"),
    );
    expect(parsed.toolCalls[0]).toMatchObject({ success: 1, durationMs: null });
  });
});

interface Metrics {
  count: number;
  /** Omitted for CLI versions that didn't record AI credits. */
  credits?: number;
  input?: number;
  output?: number;
}

const NANO_AIU_PER_AI_CREDIT = 1e9;

function start(timestamp: string): string {
  return line({ type: "session.start", timestamp, data: { sessionId: "s1", copilotVersion: "1.0.90" } });
}

function resume(timestamp: string): string {
  return line({ type: "session.resume", timestamp, data: { eventCount: 1 } });
}

function turns(count: number): string[] {
  return Array.from({ length: count }, () => line({ type: "assistant.turn_start", data: { turnId: "0" } }));
}

function shutdown(
  timestamp: string,
  metrics: Record<string, Metrics>,
  options: { apiDurationMs?: number; linesAdded?: number; linesRemoved?: number } = {},
): string {
  return line({
    type: "session.shutdown",
    timestamp,
    data: {
      shutdownType: "routine",
      totalApiDurationMs: options.apiDurationMs ?? 0,
      codeChanges: { linesAdded: options.linesAdded ?? 0, linesRemoved: options.linesRemoved ?? 0, filesModified: [] },
      modelMetrics: Object.fromEntries(
        Object.entries(metrics).map(([model, m]) => [
          model,
          {
            requests: { count: m.count, cost: 1 },
            totalNanoAiu: m.credits === undefined ? undefined : m.credits * NANO_AIU_PER_AI_CREDIT,
            usage: { inputTokens: m.input ?? 0, outputTokens: m.output ?? 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          },
        ]),
      ),
    },
  });
}

function usageRecord(timestamp: string, model: string, initiator: string, credits?: number): string {
  return line({
    type: "session.usage_record",
    timestamp,
    data: {
      usage: {
        model,
        initiator,
        cost: 1,
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 60,
        cacheWriteTokens: 30,
        copilotUsage: credits === undefined ? undefined : { totalNanoAiu: credits * NANO_AIU_PER_AI_CREDIT },
      },
    },
  });
}

function compaction(timestamp: string, model: string, credits?: number): string {
  return line({
    type: "session.compaction_complete",
    timestamp,
    data: {
      success: true,
      compactionTokensUsed: {
        model,
        inputTokens: 1000,
        outputTokens: 100,
        copilotUsage: credits === undefined ? undefined : { totalNanoAiu: credits * NANO_AIU_PER_AI_CREDIT },
      },
    },
  });
}

function totals(text: string): { requests: number; aiCredits: number; inputTokens: number } {
  const { usage } = parseEventsText(text);
  return {
    requests: usage.reduce((n, u) => n + u.requests, 0),
    aiCredits: usage.reduce((n, u) => n + (u.aiCredits ?? 0), 0),
    inputTokens: usage.reduce((n, u) => n + u.inputTokens, 0),
  };
}

describe("model usage", () => {
  it("takes a run's usage from its shutdown event", () => {
    const parsed = parseEventsText(
      [
        start("2026-05-08T13:00:00.000Z"),
        ...turns(2),
        line({
          type: "session.shutdown",
          timestamp: "2026-05-08T14:00:00.000Z",
          data: {
            modelMetrics: {
              "claude-opus-5": {
                requests: { count: 2, cost: 3 },
                totalNanoAiu: 190_128_800_000,
                usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 80, cacheWriteTokens: 5 },
              },
            },
          },
        }),
      ].join("\n"),
    );
    expect(parsed.usage).toEqual([
      {
        model: "claude-opus-5",
        timestamp: "2026-05-08T14:00:00.000Z",
        requests: 2,
        aiCredits: 190.1288,
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 80,
        cacheWriteTokens: 5,
      },
    ]);
    expect(parsed.unrecordedRuns).toBe(0);
  });

  it("leaves AI credits unrecorded for CLI versions that didn't record them", () => {
    const parsed = parseEventsText(
      [
        start("2026-05-08T13:00:00.000Z"),
        ...turns(1),
        shutdown("2026-05-08T14:00:00.000Z", { "claude-opus-4.7": { count: 1, input: 100 } }),
      ].join("\n"),
    );
    expect(parsed.usage).toMatchObject([{ model: "claude-opus-4.7", requests: 1, aiCredits: null, inputTokens: 100 }]);
  });

  it("subtracts the previous shutdown when the CLI carried its totals over a resume", () => {
    const opus = (count: number, credits: number, input: number) => ({ "claude-opus-5": { count, credits, input } });
    const parsed = parseEventsText(
      [
        start("2026-07-10T00:00:00.000Z"),
        ...turns(2),
        shutdown("2026-07-10T01:00:00.000Z", opus(2, 10, 100), { apiDurationMs: 1000 }),
        resume("2026-07-11T00:00:00.000Z"),
        ...turns(3),
        shutdown("2026-07-11T01:00:00.000Z", opus(5, 25, 250), { apiDurationMs: 2500 }),
      ].join("\n"),
    );
    expect(parsed.usage).toMatchObject([
      { timestamp: "2026-07-10T01:00:00.000Z", requests: 2, aiCredits: 10, inputTokens: 100 },
      { timestamp: "2026-07-11T01:00:00.000Z", requests: 3, aiCredits: 15, inputTokens: 150 },
    ]);
  });

  it("counts all AI credits of the first shutdown that recorded them", () => {
    const parsed = parseEventsText(
      [
        start("2026-05-11T00:00:00.000Z"),
        ...turns(2),
        shutdown("2026-05-11T01:00:00.000Z", { "claude-opus-4.7": { count: 2, input: 20 } }, { apiDurationMs: 200 }),
        resume("2026-05-12T00:00:00.000Z"),
        ...turns(1),
        shutdown(
          "2026-05-12T01:00:00.000Z",
          { "claude-opus-4.7": { count: 3, credits: 5, input: 30 } },
          { apiDurationMs: 300 },
        ),
      ].join("\n"),
    );
    expect(parsed.usage).toMatchObject([
      { requests: 2, aiCredits: null, inputTokens: 20 },
      { requests: 1, aiCredits: 5, inputTokens: 10 },
    ]);
  });

  it("adds up shutdowns that reported only their own run", () => {
    const log = [
      start("2026-05-10T00:00:00.000Z"),
      ...turns(4),
      shutdown(
        "2026-05-10T01:00:00.000Z",
        { "claude-opus-5": { count: 4, credits: 20, input: 400 } },
        { apiDurationMs: 4000 },
      ),
      resume("2026-05-11T00:00:00.000Z"),
      ...turns(1),
      shutdown("2026-05-11T01:00:00.000Z", { "claude-opus-5": { count: 1, credits: 5, input: 50 } }, { apiDurationMs: 500 }),
    ].join("\n");
    expect(totals(log)).toEqual({ requests: 5, aiCredits: 25, inputTokens: 450 });
  });

  it("treats a shutdown missing a model the previous one had as reporting only its own run", () => {
    const log = [
      start("2026-05-10T00:00:00.000Z"),
      ...turns(1),
      shutdown("2026-05-10T01:00:00.000Z", { "gpt-5.5": { count: 1, credits: 1 } }),
      resume("2026-05-11T00:00:00.000Z"),
      ...turns(4),
      shutdown("2026-05-11T01:00:00.000Z", { "claude-opus-5": { count: 4, credits: 3 } }),
    ].join("\n");
    expect(totals(log)).toMatchObject({ requests: 5, aiCredits: 4 });
  });

  it("treats a shutdown whose AI credits went down as reporting only its own run", () => {
    const log = [
      start("2026-05-10T00:00:00.000Z"),
      ...turns(2),
      shutdown("2026-05-10T01:00:00.000Z", { "claude-opus-5": { count: 2, credits: 10, input: 20 } }),
      resume("2026-05-11T00:00:00.000Z"),
      shutdown("2026-05-11T01:00:00.000Z", { "claude-opus-5": { count: 2, credits: 4, input: 20 } }),
    ].join("\n");
    expect(totals(log)).toEqual({ requests: 4, aiCredits: 14, inputTokens: 40 });
  });

  it("tells a growing shutdown that reported only its own run by the run's model turns", () => {
    const log = [
      start("2026-05-10T00:00:00.000Z"),
      ...turns(1),
      shutdown("2026-05-10T01:00:00.000Z", { "claude-opus-5": { count: 1, credits: 1, input: 10 } }, { apiDurationMs: 100 }),
      resume("2026-05-11T00:00:00.000Z"),
      ...turns(3),
      shutdown("2026-05-11T01:00:00.000Z", { "claude-opus-5": { count: 3, credits: 3, input: 30 } }, { apiDurationMs: 300 }),
    ].join("\n");
    expect(totals(log)).toEqual({ requests: 4, aiCredits: 4, inputTokens: 40 });
  });

  it("does not count a resume without model calls twice", () => {
    const carriedOver = [
      start("2026-08-01T00:00:00.000Z"),
      ...turns(2),
      shutdown("2026-08-01T01:00:00.000Z", { "claude-opus-5": { count: 2, credits: 1, input: 20 } }, { apiDurationMs: 200 }),
      resume("2026-08-02T00:00:00.000Z"),
      shutdown("2026-08-02T01:00:00.000Z", { "claude-opus-5": { count: 2, credits: 1, input: 20 } }, { apiDurationMs: 200 }),
    ].join("\n");
    expect(totals(carriedOver)).toEqual({ requests: 2, aiCredits: 1, inputTokens: 20 });

    const reset = [
      start("2026-05-01T00:00:00.000Z"),
      ...turns(2),
      shutdown("2026-05-01T01:00:00.000Z", { "claude-opus-5": { count: 2, credits: 1, input: 20 } }, { apiDurationMs: 200 }),
      resume("2026-05-02T00:00:00.000Z"),
      shutdown("2026-05-02T01:00:00.000Z", { "claude-opus-5": { count: 0, credits: 0, input: 0 } }),
    ].join("\n");
    expect(parseEventsText(reset).usage).toHaveLength(1);
    expect(totals(reset)).toEqual({ requests: 2, aiCredits: 1, inputTokens: 20 });
  });

  it("prefers per-call usage records and counts the AI credits of every call", () => {
    const parsed = parseEventsText(
      [
        start("2026-10-20T00:00:00.000Z"),
        ...turns(1),
        usageRecord("2026-10-20T00:01:00.000Z", "claude-opus-5.5", "user", 40),
        ...turns(1),
        usageRecord("2026-10-20T00:02:00.000Z", "claude-opus-5.5", "agent", 20),
        usageRecord("2026-10-20T00:03:00.000Z", "gpt-5.6-sol", "sub-agent", 0.5),
        shutdown("2026-10-20T01:00:00.000Z", {
          "claude-opus-5.5": { count: 2, credits: 60, input: 200 },
          "gpt-5.6-sol": { count: 1, credits: 0.5, input: 100 },
        }),
      ].join("\n"),
    );
    expect(parsed.usage).toEqual([
      {
        model: "claude-opus-5.5",
        timestamp: "2026-10-20T00:01:00.000Z",
        requests: 1,
        aiCredits: 40,
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 60,
        cacheWriteTokens: 30,
      },
      expect.objectContaining({ model: "claude-opus-5.5", timestamp: "2026-10-20T00:02:00.000Z", aiCredits: 20 }),
      expect.objectContaining({ model: "gpt-5.6-sol", timestamp: "2026-10-20T00:03:00.000Z", aiCredits: 0.5 }),
    ]);
  });

  it("adds the AI credits of compactions, which write no usage record, to usage records", () => {
    const parsed = parseEventsText(
      [
        start("2026-10-20T00:00:00.000Z"),
        ...turns(1),
        usageRecord("2026-10-20T00:01:00.000Z", "claude-opus-5.5", "user", 40),
        compaction("2026-10-20T00:02:00.000Z", "claude-opus-5.5", 30),
        shutdown("2026-10-20T01:00:00.000Z", { "claude-opus-5.5": { count: 1, credits: 70, input: 100 } }),
      ].join("\n"),
    );
    expect(parsed.usage).toEqual([
      expect.objectContaining({ timestamp: "2026-10-20T00:01:00.000Z", requests: 1, aiCredits: 40 }),
      {
        model: "claude-opus-5.5",
        timestamp: "2026-10-20T00:02:00.000Z",
        requests: 0,
        aiCredits: 30,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ]);
  });

  it("does not add compactions to usage from a shutdown, whose AI credits include them", () => {
    const log = [
      start("2026-09-20T00:00:00.000Z"),
      ...turns(1),
      compaction("2026-09-20T00:02:00.000Z", "claude-sonnet-5", 30),
      shutdown("2026-09-20T01:00:00.000Z", { "claude-sonnet-5": { count: 1, credits: 70, input: 100 } }),
    ].join("\n");
    expect(totals(log)).toEqual({ requests: 1, aiCredits: 70, inputTokens: 100 });
  });

  it("leaves AI credits unrecorded for usage records without them and skips such compactions", () => {
    const parsed = parseEventsText(
      [
        start("2026-10-20T00:00:00.000Z"),
        ...turns(1),
        usageRecord("2026-10-20T00:01:00.000Z", "claude-opus-5.5", "user"),
        compaction("2026-10-20T00:02:00.000Z", "claude-opus-5.5"),
      ].join("\n"),
    );
    expect(parsed.usage).toMatchObject([{ requests: 1, aiCredits: null }]);
    expect(parsed.usage).toHaveLength(1);
  });

  it("counts runs that called a model without recording usage", () => {
    const parsed = parseEventsText(
      [
        start("2026-06-01T00:00:00.000Z"),
        ...turns(3),
        resume("2026-06-02T00:00:00.000Z"),
        shutdown("2026-06-02T01:00:00.000Z", {}),
        resume("2026-06-03T00:00:00.000Z"),
        ...turns(2),
      ].join("\n"),
    );
    expect(parsed).toMatchObject({ usage: [], unrecordedRuns: 2 });
  });

  it("counts usage records of a run that has not shut down yet", () => {
    const parsed = parseEventsText(
      [
        start("2026-10-20T00:00:00.000Z"),
        ...turns(1),
        usageRecord("2026-10-20T00:01:00.000Z", "claude-opus-5.5", "user", 15),
      ].join("\n"),
    );
    expect(parsed).toMatchObject({ usage: [{ requests: 1, aiCredits: 15 }], unrecordedRuns: 0 });
  });

  it("takes code changes from the last shutdown, since every CLI reports them cumulatively", () => {
    const parsed = parseEventsText(
      [
        start("2026-05-01T00:00:00.000Z"),
        shutdown("2026-05-01T01:00:00.000Z", {}, { linesAdded: 10, linesRemoved: 2 }),
        resume("2026-05-02T00:00:00.000Z"),
        shutdown("2026-05-02T01:00:00.000Z", {}, { linesAdded: 25, linesRemoved: 4 }),
      ].join("\n"),
    );
    expect(parsed).toMatchObject({ linesAdded: 25, linesRemoved: 4 });
  });
});

describe("events the indexer has no use for", () => {
  const parentId = "8c5e0d1e-1f0a-4b9a-9d1e-0a8f3c2b7e61";

  it("still count toward the time range, while other events are read in full", () => {
    const parsed = parseEventsText(
      [
        cliLine("hook.start", "2026-05-08T13:00:00.000Z", { input: { toolName: "bash" } }),
        cliLine("session.start", "2026-05-08T13:04:00.000Z", { selectedModel: "claude-opus-5" }, parentId),
        cliLine("user.message", "2026-05-08T13:05:00.000Z", { content: "Run the tests" }, parentId),
        cliLine("hook.end", "2026-05-08T13:30:00.000Z", { success: true }, parentId),
      ].join("\n"),
    );
    expect(parsed).toMatchObject({
      startedAt: "2026-05-08T13:00:00.000Z",
      endedAt: "2026-05-08T13:30:00.000Z",
      models: ["claude-opus-5"],
      messages: [{ role: "user", content: "Run the tests" }],
      malformedLines: 0,
    });
  });

  it("are not parsed, since only their timestamp is needed", () => {
    const parsed = parseEventsText(
      [
        start("2026-05-08T13:04:00.000Z"),
        '{"type":"hook.end","data":{"output":<not parsed>},"id":"e1","timestamp":"2026-05-08T13:30:00.000Z","parentId":null}',
      ].join("\n"),
    );
    expect(parsed).toMatchObject({ endedAt: "2026-05-08T13:30:00.000Z", malformedLines: 0 });
  });

  it("count toward the time range when their keys come in another order", () => {
    const parsed = parseEventsText(
      [
        line({ type: "hook.start", timestamp: "2026-05-08T13:00:00.000Z", data: {} }),
        start("2026-05-08T13:04:00.000Z"),
        line({ timestamp: "2026-05-08T13:30:00.000Z", type: "hook.end", data: {}, parentId }),
      ].join("\n"),
    );
    expect(parsed).toMatchObject({ startedAt: "2026-05-08T13:00:00.000Z", endedAt: "2026-05-08T13:30:00.000Z" });
  });

  it("count as malformed when truncated, even when the next event was appended to them", () => {
    const appended = cliLine("session.resume", "2026-05-08T14:00:00.000Z", {}, parentId);
    const parsed = parseEventsText(
      [
        start("2026-05-08T13:04:00.000Z"),
        `{"type":"hook.start","data":{"input":{"toolName":"ba${appended}`,
        '{"type":"hook.end","data":{"succ',
      ].join("\n"),
    );
    expect(parsed).toMatchObject({ malformedLines: 2, endedAt: "2026-05-08T13:04:00.000Z" });
  });
});

describe("line endings", () => {
  it("reads CRLF line endings like LF", () => {
    const log = [
      cliLine("hook.start", "2026-05-08T13:00:00.000Z"),
      start("2026-05-08T13:04:00.000Z"),
      line({ type: "user.message", timestamp: "2026-05-08T13:05:00.000Z", data: { content: "first\nsecond" } }),
      cliLine("hook.end", "2026-05-08T13:30:00.000Z"),
      "",
    ].join("\n");
    const parsed = parseEventsText(log.replaceAll("\n", "\r\n"));
    expect(parsed).toEqual(parseEventsText(log));
    expect(parsed).toMatchObject({ endedAt: "2026-05-08T13:30:00.000Z", malformedLines: 0 });
  });
});

describe("parseEventsFile", () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "copilotview-events-test-"));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads the same events whatever the size of the chunks it reads", async () => {
    const log = [
      LOG,
      cliLine("hook.end", "2026-05-08T13:30:00.000Z", { output: "x".repeat(5000) }),
      line({ type: "user.message", timestamp: "2026-05-08T13:31:00.000Z", data: { content: "長い入力".repeat(2000) } }),
      '{"type":"hook.start","data":{"inp',
    ].join("\n");
    const file = path.join(dir, "events.jsonl");
    fs.writeFileSync(file, log);

    const expected = parseEventsText(log);
    expect(expected).toMatchObject({ endedAt: "2026-05-08T13:31:00.000Z", malformedLines: 2 });
    expect(expected.messages.at(-1)?.content).toBe("長い入力".repeat(2000));
    for (const chunkSize of [1, 5, 64, 4096, undefined]) {
      expect(await parseEventsFile(file, chunkSize)).toEqual(expected);
    }
  });
});

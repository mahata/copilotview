import { describe, expect, it } from "vitest";
import { parseEventsText } from "../src/indexer/events";

function line(obj: unknown): string {
  return JSON.stringify(obj);
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
      { toolName: "edit", target: "/w/.github/workflows/ci.yml", success: 1 },
      { toolName: "bash", target: "pytest -q", success: 0 },
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
});

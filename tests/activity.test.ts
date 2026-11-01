import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rollUpActivity, type ActivitySlot } from "../src/db/activity";
import { openIndex } from "../src/db/schema";
import type { Database } from "../src/db/sqlite";
import { indexSessions } from "../src/indexer/scan";
import type { ParsedMessage, ParsedToolCall, ParsedUsage } from "../src/types";

function message(role: ParsedMessage["role"], timestamp: string | null, source: string | null = null): ParsedMessage {
  return { seq: 0, role, content: "text", timestamp, source, agentMode: null, model: null, isSubagent: false };
}

function toolCall(timestamp: string | null): ParsedToolCall {
  return { seq: 0, toolCallId: null, toolName: "bash", target: null, success: 1, timestamp, durationMs: null };
}

function usage(model: string, timestamp: string, requests: number, aiCredits: number | null): ParsedUsage {
  return {
    model,
    timestamp,
    requests,
    aiCredits,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function slot(slotStart: string, counts: Partial<Omit<ActivitySlot, "slotStart">>): ActivitySlot {
  return {
    slotStart: Date.parse(slotStart),
    model: "",
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    requests: 0,
    aiCredits: null,
    requestsWithoutAiCredits: 0,
    ...counts,
  };
}

const noActivity = { messages: [], toolCalls: [], usage: [] };

describe("rollUpActivity", () => {
  it("totals messages and tool calls by the UTC quarter hour they happened in", () => {
    const activity = rollUpActivity(
      {
        ...noActivity,
        messages: [
          message("user", "2026-10-01T10:00:00.000Z"),
          message("user", "2026-10-01T10:14:59.999Z"),
          message("user", "2026-10-01T10:15:00.000Z"),
          message("assistant", "2026-10-01T10:20:00.000Z"),
        ],
        toolCalls: [toolCall("2026-10-01T10:01:00.000Z"), toolCall("2026-10-01T10:16:00.000Z")],
      },
      null,
    );

    expect(activity).toEqual([
      slot("2026-10-01T10:00:00.000Z", { userMessages: 2, toolCalls: 1 }),
      slot("2026-10-01T10:15:00.000Z", { userMessages: 1, assistantMessages: 1, toolCalls: 1 }),
    ]);
  });

  it("leaves out messages injected by skills, other agents, or the system", () => {
    const subagentResponse = { ...message("assistant", "2026-10-01T10:05:00.000Z"), isSubagent: true };
    const activity = rollUpActivity(
      {
        ...noActivity,
        messages: [
          message("user", "2026-10-01T10:00:00.000Z", "skill-workiq"),
          message("user", "2026-10-01T10:01:00.000Z", "agent-1234"),
          subagentResponse,
          message("user", "2026-10-01T11:00:00.000Z", "system"),
        ],
      },
      null,
    );

    expect(activity).toEqual([slot("2026-10-01T10:00:00.000Z", { assistantMessages: 1 })]);
  });

  it("keeps each model's usage apart and totals AI credits only from usage that recorded them", () => {
    const activity = rollUpActivity(
      {
        ...noActivity,
        usage: [
          usage("claude-opus-5.5", "2026-10-01T10:05:00.000Z", 1, 2.5),
          usage("gpt-5.5", "2026-10-01T10:07:00.000Z", 2, null),
          usage("claude-opus-5.5", "2026-10-01T10:10:00.000Z", 1, 1),
          usage("claude-opus-5.5", "2026-10-01T10:12:00.000Z", 0, 0.5),
        ],
      },
      null,
    );

    expect(activity).toEqual([
      slot("2026-10-01T10:00:00.000Z", { model: "claude-opus-5.5", requests: 2, aiCredits: 4 }),
      slot("2026-10-01T10:00:00.000Z", { model: "gpt-5.5", requests: 2, requestsWithoutAiCredits: 2 }),
    ]);
  });

  it("places undated items at the session's last update", () => {
    const activity = rollUpActivity(
      { ...noActivity, messages: [message("user", null)], toolCalls: [toolCall(null)] },
      "2026-10-01T09:59:00.000Z",
    );

    expect(activity).toEqual([slot("2026-10-01T09:45:00.000Z", { userMessages: 1, toolCalls: 1 })]);
  });

  it("places items with unreadable times at the session's last update, and leaves them out without one", () => {
    const events = { ...noActivity, messages: [message("user", "yesterday")] };

    expect(rollUpActivity(events, "2026-10-01T09:59:00.000Z")).toEqual([
      slot("2026-10-01T09:45:00.000Z", { userMessages: 1 }),
    ]);
    expect(rollUpActivity(events, null)).toEqual([]);
    expect(rollUpActivity(events, "unknown")).toEqual([]);
  });
});

function jsonl(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

describe("indexed activity", () => {
  let root: string;
  let db: Database;

  function writeSession(id: string, prompt: { content: string; timestamp: string }): void {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "workspace.yaml"), `id: ${id}\nupdated_at: 2026-10-01T12:00:00.000Z\n`);
    fs.writeFileSync(
      path.join(dir, "events.jsonl"),
      jsonl(
        { type: "session.start", timestamp: prompt.timestamp, data: { sessionId: id } },
        { type: "user.message", timestamp: prompt.timestamp, data: { content: prompt.content } },
        {
          type: "session.usage_record",
          timestamp: prompt.timestamp,
          data: { usage: { model: "claude-opus-5.5", inputTokens: 10, copilotUsage: { totalNanoAiu: 3e9 } } },
        },
      ),
    );
  }

  function storedActivity(): unknown[] {
    return db
      .prepare(
        `SELECT session_id, slot_start, model, user_messages, requests, ai_credits
         FROM activity_slots ORDER BY session_id, slot_start, model`,
      )
      .all()
      .map((row) => ({ ...row }));
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "copilotview-activity-test-"));
    db = openIndex(":memory:");
  });

  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("stores each session's activity by quarter hour", async () => {
    writeSession("aaaa", { content: "first", timestamp: "2026-10-01T10:20:00.000Z" });
    await indexSessions(db, root);

    expect(storedActivity()).toEqual([
      {
        session_id: "aaaa",
        slot_start: Date.parse("2026-10-01T10:15:00.000Z"),
        model: "",
        user_messages: 1,
        requests: 0,
        ai_credits: null,
      },
      {
        session_id: "aaaa",
        slot_start: Date.parse("2026-10-01T10:15:00.000Z"),
        model: "claude-opus-5.5",
        user_messages: 0,
        requests: 1,
        ai_credits: 3,
      },
    ]);
  });

  it("replaces a session's activity when it changes and drops it when the session is deleted", async () => {
    writeSession("aaaa", { content: "first", timestamp: "2026-10-01T10:20:00.000Z" });
    writeSession("bbbb", { content: "other", timestamp: "2026-10-02T10:20:00.000Z" });
    await indexSessions(db, root);

    writeSession("aaaa", { content: "rewritten", timestamp: "2026-10-01T11:40:00.000Z" });
    fs.rmSync(path.join(root, "bbbb"), { recursive: true });
    expect(await indexSessions(db, root)).toMatchObject({ indexed: 1, removed: 1 });

    expect(storedActivity()).toEqual([
      expect.objectContaining({ session_id: "aaaa", slot_start: Date.parse("2026-10-01T11:30:00.000Z"), model: "" }),
      expect.objectContaining({
        session_id: "aaaa",
        slot_start: Date.parse("2026-10-01T11:30:00.000Z"),
        model: "claude-opus-5.5",
      }),
    ]);
  });
});

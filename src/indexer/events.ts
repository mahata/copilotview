import fs from "node:fs";
import readline from "node:readline";
import type { ParsedEvents } from "../types";

/** Tool arguments whose values point at a file in the workspace. */
const PATH_KEYS = ["path", "file", "filePath", "file_path", "filename"];

const MAX_TARGET_LENGTH = 300;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function extractPath(args: Record<string, unknown>): string | null {
  for (const key of PATH_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function extractTarget(toolName: string, args: Record<string, unknown>): string | null {
  const filePath = extractPath(args);
  if (filePath) return filePath.slice(0, MAX_TARGET_LENGTH);
  const fallbackKeys =
    toolName === "bash"
      ? ["command", "description"]
      : ["pattern", "query", "url", "title", "prompt", "description"];
  for (const key of fallbackKeys) {
    const v = args[key];
    if (typeof v === "string" && v.length > 0) {
      return v.split("\n", 1)[0]!.slice(0, MAX_TARGET_LENGTH);
    }
  }
  return null;
}

interface Accumulator extends ParsedEvents {
  seq: number;
}

function emptyAccumulator(): Accumulator {
  return {
    seq: 0,
    messages: [],
    toolCalls: [],
    artifacts: [],
    files: [],
    models: [],
    copilotVersion: null,
    startedAt: null,
    endedAt: null,
    headCommit: null,
    malformedLines: 0,
    context: {},
  };
}

function handleEvent(acc: Accumulator, event: Record<string, unknown>): void {
  const type = asString(event.type);
  if (!type) return;
  const data = asRecord(event.data);
  const timestamp = asString(event.timestamp);
  if (timestamp) {
    if (acc.startedAt === null || timestamp < acc.startedAt) acc.startedAt = timestamp;
    if (acc.endedAt === null || timestamp > acc.endedAt) acc.endedAt = timestamp;
  }

  switch (type) {
    case "session.start": {
      acc.copilotVersion = asString(data.copilotVersion) ?? acc.copilotVersion;
      const model = asString(data.selectedModel);
      if (model && !acc.models.includes(model)) acc.models.push(model);
      const ctx = asRecord(data.context);
      acc.context = {
        cwd: asString(ctx.cwd) ?? acc.context.cwd,
        gitRoot: asString(ctx.gitRoot) ?? acc.context.gitRoot,
        branch: asString(ctx.branch) ?? acc.context.branch,
        repository: asString(ctx.repository) ?? acc.context.repository,
        hostType: asString(ctx.hostType) ?? acc.context.hostType,
      };
      acc.headCommit = asString(ctx.headCommit) ?? acc.headCommit;
      break;
    }
    case "session.model_change": {
      const model = asString(data.model) ?? asString(data.selectedModel) ?? asString(data.to);
      if (model && !acc.models.includes(model)) acc.models.push(model);
      break;
    }
    case "user.message": {
      const content = asString(data.content);
      if (!content) break;
      acc.messages.push({
        seq: acc.seq++,
        role: "user",
        content,
        timestamp,
        source: asString(data.source),
        agentMode: asString(data.agentMode),
        model: null,
        // `parentAgentTaskId` is present on ordinary top-level messages too;
        // only the `agent-*` source identifies another agent as the speaker.
        isSubagent: (asString(data.source) ?? "").startsWith("agent-"),
      });
      break;
    }
    case "assistant.message": {
      const model = asString(data.model);
      if (model && !acc.models.includes(model)) acc.models.push(model);
      const content = asString(data.content);
      if (content) {
        acc.messages.push({
          seq: acc.seq++,
          role: "assistant",
          content,
          timestamp,
          source: null,
          agentMode: null,
          model,
          isSubagent: asString(data.parentToolCallId) !== null,
        });
      }
      break;
    }
    case "tool.execution_start": {
      const toolName = asString(data.toolName);
      if (!toolName) break;
      const args = asRecord(data.arguments);
      acc.toolCalls.push({
        seq: acc.seq++,
        toolCallId: asString(data.toolCallId),
        toolName,
        target: extractTarget(toolName, args),
        success: null,
        timestamp,
      });
      const filePath = extractPath(args);
      if (filePath) acc.files.push({ path: filePath, toolName });
      break;
    }
    case "tool.execution_complete": {
      const toolCallId = asString(data.toolCallId);
      if (!toolCallId) break;
      const success = data.success === true ? 1 : data.success === false ? 0 : null;
      if (success === null) break;
      for (let i = acc.toolCalls.length - 1; i >= 0; i -= 1) {
        const call = acc.toolCalls[i]!;
        if (call.toolCallId === toolCallId) {
          call.success = success;
          break;
        }
      }
      break;
    }
    case "session.task_complete": {
      const summary = asString(data.summary);
      if (!summary) break;
      acc.artifacts.push({
        kind: "task_complete",
        ordinal: acc.artifacts.filter((a) => a.kind === "task_complete").length,
        title: null,
        body: summary,
      });
      break;
    }
    case "session.plan_changed": {
      const plan = asString(data.plan) ?? asString(data.content);
      if (!plan) break;
      acc.artifacts.push({
        kind: "plan",
        ordinal: acc.artifacts.filter((a) => a.kind === "plan").length,
        title: null,
        body: plan,
      });
      break;
    }
    default:
      break;
  }
}

function finalize(acc: Accumulator): ParsedEvents {
  const { seq, ...rest } = acc;
  void seq;
  return rest;
}

/** Parses a JSONL event log already held in memory. Used by tests. */
export function parseEventsText(text: string): ParsedEvents {
  const acc = emptyAccumulator();
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      acc.malformedLines += 1;
      continue;
    }
    handleEvent(acc, asRecord(event));
  }
  return finalize(acc);
}

/**
 * Streams `events.jsonl` line by line. Logs are routinely hundreds of megabytes
 * and may end mid-line when a session was killed, so malformed lines are
 * counted and skipped rather than thrown.
 */
export async function parseEventsFile(filePath: string): Promise<ParsedEvents> {
  const acc = emptyAccumulator();
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (line.trim().length === 0) continue;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        acc.malformedLines += 1;
        continue;
      }
      handleEvent(acc, asRecord(event));
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return finalize(acc);
}

import fsp from "node:fs/promises";
import type { ParsedEvents } from "../types";
import { createUsageTracker, type UsageSummary, type UsageTracker } from "./usage";

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

function elapsedMs(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

interface Accumulator extends Omit<ParsedEvents, keyof UsageSummary> {
  seq: number;
  usageTracker: UsageTracker;
}

function emptyAccumulator(): Accumulator {
  return {
    seq: 0,
    usageTracker: createUsageTracker(),
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

type EventHandler = (acc: Accumulator, data: Record<string, unknown>, timestamp: string | null) => void;

const HANDLERS = new Map(
  Object.entries<EventHandler>({
    "session.start"(acc, data) {
      acc.usageTracker.startRun();
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
    },

    "session.model_change"(acc, data) {
      const model = asString(data.model) ?? asString(data.selectedModel) ?? asString(data.to);
      if (model && !acc.models.includes(model)) acc.models.push(model);
    },

    "user.message"(acc, data, timestamp) {
      const content = asString(data.content);
      if (!content) return;
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
    },

    "assistant.message"(acc, data, timestamp) {
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
    },

    "tool.execution_start"(acc, data, timestamp) {
      const toolName = asString(data.toolName);
      if (!toolName) return;
      const args = asRecord(data.arguments);
      acc.toolCalls.push({
        seq: acc.seq++,
        toolCallId: asString(data.toolCallId),
        toolName,
        target: extractTarget(toolName, args),
        success: null,
        timestamp,
        durationMs: null,
      });
      const filePath = extractPath(args);
      if (filePath) acc.files.push({ path: filePath, toolName });
    },

    "tool.execution_complete"(acc, data, timestamp) {
      const toolCallId = asString(data.toolCallId);
      if (!toolCallId) return;
      for (let i = acc.toolCalls.length - 1; i >= 0; i -= 1) {
        const call = acc.toolCalls[i]!;
        if (call.toolCallId !== toolCallId) continue;
        if (data.success === true) call.success = 1;
        else if (data.success === false) call.success = 0;
        call.durationMs = elapsedMs(call.timestamp, timestamp);
        break;
      }
    },

    "session.task_complete"(acc, data) {
      const summary = asString(data.summary);
      if (!summary) return;
      acc.artifacts.push({
        kind: "task_complete",
        ordinal: acc.artifacts.filter((a) => a.kind === "task_complete").length,
        title: null,
        body: summary,
      });
    },

    "session.plan_changed"(acc, data) {
      const plan = asString(data.plan) ?? asString(data.content);
      if (!plan) return;
      acc.artifacts.push({
        kind: "plan",
        ordinal: acc.artifacts.filter((a) => a.kind === "plan").length,
        title: null,
        body: plan,
      });
    },

    "session.resume"(acc) {
      acc.usageTracker.startRun();
    },

    "assistant.turn_start"(acc) {
      acc.usageTracker.turnStarted();
    },

    "session.usage_record"(acc, data, timestamp) {
      acc.usageTracker.usageRecord(data, timestamp);
    },

    "session.compaction_complete"(acc, data, timestamp) {
      acc.usageTracker.compaction(data, timestamp);
    },

    "session.shutdown"(acc, data, timestamp) {
      acc.usageTracker.shutdown(data, timestamp);
    },
  }),
);

function noteTimestamp(acc: Accumulator, timestamp: string): void {
  if (acc.startedAt === null || timestamp < acc.startedAt) acc.startedAt = timestamp;
  if (acc.endedAt === null || timestamp > acc.endedAt) acc.endedAt = timestamp;
}

function handleEvent(acc: Accumulator, event: Record<string, unknown>): void {
  const type = asString(event.type);
  if (!type) return;
  const timestamp = asString(event.timestamp);
  if (timestamp) noteTimestamp(acc, timestamp);
  HANDLERS.get(type)?.(acc, asRecord(event.data), timestamp);
}

const EVENT_START = Buffer.from('{"type":"');
const IGNORED_EVENT_HEAD = /^\{"type":"([\w.-]+)"/;
const IGNORED_EVENT_TAIL = /,"timestamp":"([\w:.+-]+)","parentId":(?:null|"[\w-]*")\}[ \t\r]*$/;

/**
 * Returns the timestamp of a line whose event type has no handler, or null
 * when the line has to be parsed. Such events, e.g. hook payloads and system
 * prompts, make up much of a log, yet only their timestamp counts. They are
 * recognized by the layout the CLI writes,
 * `{"type":…,"data":…,"id":…,"timestamp":…,"parentId":…}`. A line that departs
 * from it, or that contains the start of another event because a truncated
 * line had the next one appended to it, is parsed in full.
 */
function ignoredEventTimestamp(line: Buffer): string | null {
  const head = IGNORED_EVENT_HEAD.exec(line.toString("latin1", 0, 128));
  if (!head || HANDLERS.has(head[1]!)) return null;
  const tail = IGNORED_EVENT_TAIL.exec(line.toString("latin1", Math.max(0, line.length - 256)));
  if (!tail || line.indexOf(EVENT_START, 1) !== -1) return null;
  return tail[1]!;
}

function handleLine(acc: Accumulator, line: Buffer): void {
  const ignoredAt = ignoredEventTimestamp(line);
  if (ignoredAt !== null) {
    noteTimestamp(acc, ignoredAt);
    return;
  }
  const text = line.toString("utf8");
  if (text.trim().length === 0) return;
  let event: unknown;
  try {
    event = JSON.parse(text);
  } catch {
    acc.malformedLines += 1;
    return;
  }
  handleEvent(acc, asRecord(event));
}

/** Passes each newline-terminated line to `onLine` and returns where the unterminated rest starts. */
function splitLines(buffer: Buffer, onLine: (line: Buffer) => void): number {
  let start = 0;
  for (let end = buffer.indexOf(0x0a); end !== -1; end = buffer.indexOf(0x0a, start)) {
    onLine(buffer.subarray(start, end));
    start = end + 1;
  }
  return start;
}

function finalize(acc: Accumulator): ParsedEvents {
  const { seq, usageTracker, ...rest } = acc;
  void seq;
  return { ...rest, ...usageTracker.finish() };
}

/** Parses a JSONL event log already held in memory. Used by tests. */
export function parseEventsText(text: string): ParsedEvents {
  const acc = emptyAccumulator();
  const buffer = Buffer.from(text, "utf8");
  const rest = splitLines(buffer, (line) => handleLine(acc, line));
  if (rest < buffer.length) handleLine(acc, buffer.subarray(rest));
  return finalize(acc);
}

const CHUNK_SIZE = 1024 * 1024;

/**
 * Reads `events.jsonl` in chunks and handles it line by line, so memory use
 * follows the longest line rather than the size of the log. Logs are routinely
 * hundreds of megabytes and may end mid-line when a session was killed, so
 * malformed lines are counted and skipped rather than thrown.
 */
export async function parseEventsFile(filePath: string, chunkSize = CHUNK_SIZE): Promise<ParsedEvents> {
  const acc = emptyAccumulator();
  const onLine = (line: Buffer) => handleLine(acc, line);
  const file = await fsp.open(filePath, "r");
  try {
    let buffer = Buffer.allocUnsafe(chunkSize);
    let length = 0;
    for (;;) {
      if (length === buffer.length) {
        const grown = Buffer.allocUnsafe(buffer.length * 2);
        buffer.copy(grown, 0, 0, length);
        buffer = grown;
      }
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      const filled = length + bytesRead;
      const rest = splitLines(buffer.subarray(0, filled), onLine);
      buffer.copy(buffer, 0, rest, filled);
      length = filled - rest;
    }
    if (length > 0) onLine(buffer.subarray(0, length));
  } finally {
    await file.close();
  }
  return finalize(acc);
}

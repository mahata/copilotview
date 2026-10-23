export interface SessionWorkspace {
  id: string;
  cwd?: string;
  gitRoot?: string;
  repository?: string;
  hostType?: string;
  branch?: string;
  name?: string;
  summary?: string;
  userNamed?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type MessageRole = "user" | "assistant";

export interface ParsedMessage {
  seq: number;
  role: MessageRole;
  content: string;
  timestamp: string | null;
  /**
   * Non-null when the message was injected by a skill, another agent or the
   * system rather than typed by the user.
   */
  source: string | null;
  agentMode: string | null;
  model: string | null;
  isSubagent: boolean;
}

export interface ParsedToolCall {
  seq: number;
  toolCallId: string | null;
  toolName: string;
  target: string | null;
  success: number | null;
  timestamp: string | null;
  durationMs: number | null;
}

export interface UsageTotals {
  requests: number;
  premiumRequests: number;
  /** Includes cached input, i.e. cache reads and cache writes. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Model usage attributed to the time it was recorded. */
export interface ParsedUsage extends UsageTotals {
  model: string;
  timestamp: string | null;
}

export type ArtifactKind = "task_complete" | "checkpoint" | "plan";

export interface ParsedArtifact {
  kind: ArtifactKind;
  ordinal: number;
  title: string | null;
  body: string;
}

export interface ParsedEvents {
  messages: ParsedMessage[];
  toolCalls: ParsedToolCall[];
  artifacts: ParsedArtifact[];
  files: { path: string; toolName: string }[];
  usage: ParsedUsage[];
  /** CLI runs that called a model but recorded no usage, e.g. because they crashed. */
  unrecordedRuns: number;
  linesAdded: number | null;
  linesRemoved: number | null;
  models: string[];
  copilotVersion: string | null;
  startedAt: string | null;
  endedAt: string | null;
  headCommit: string | null;
  malformedLines: number;
  context: {
    cwd?: string;
    gitRoot?: string;
    branch?: string;
    repository?: string;
    hostType?: string;
  };
}

export interface SessionRecord extends SessionWorkspace {
  dirPath: string;
  sourceSize: number;
  sourceMtime: number;
}

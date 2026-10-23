export interface Snippet {
  text: string;
  ranges: [number, number][];
}

export interface SessionSummary {
  id: string;
  name: string | null;
  summary: string | null;
  repository: string | null;
  branch: string | null;
  cwd: string | null;
  models: string[];
  createdAt: string | null;
  updatedAt: string | null;
  durationMs: number | null;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  fileCount: number;
  artifactCount: number;
}

export interface SearchHit {
  session: SessionSummary;
  kind: "message" | "artifact" | "file";
  role: string | null;
  snippet: Snippet;
  timestamp: string | null;
  seq: number | null;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  fallbackTerms: string[];
}

export interface UsageTotals {
  requests: number;
  /**
   * GitHub AI Credits, where 1 AI credit is $0.01 USD; null when there is usage
   * but none of it recorded AI credits.
   */
  aiCredits: number | null;
  /** Model requests whose usage the CLI recorded without AI credits. */
  requestsWithoutAiCredits: number;
  /** Includes cached input, i.e. cache reads and cache writes. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ModelUsage extends UsageTotals {
  model: string;
}

export interface CodeChanges {
  linesAdded: number;
  linesRemoved: number;
}

export interface SessionDetail {
  session: SessionSummary & {
    hostType: string | null;
    gitRoot: string | null;
    headCommit: string | null;
    copilotVersion: string | null;
    startedAt: string | null;
    endedAt: string | null;
    malformedLines: number;
    dirPath: string;
  };
  artifacts: { kind: string; ordinal: number; title: string | null; body: string }[];
  files: { path: string; toolName: string | null; touchCount: number }[];
  toolUsage: { toolName: string; count: number; failures: number }[];
  usage: { total: UsageTotals; byModel: ModelUsage[]; unrecordedRuns: number };
  codeChanges: CodeChanges | null;
}

export type TimelineEntry =
  | {
      kind: "message";
      seq: number;
      role: string;
      content: string;
      timestamp: string | null;
      source: string | null;
      agentMode: string | null;
      model: string | null;
      isSubagent: boolean;
    }
  | {
      kind: "tool";
      seq: number;
      toolName: string;
      target: string | null;
      success: number | null;
      timestamp: string | null;
    };

export interface Stats {
  sessionCount: number;
  messageCount: number;
  toolCallCount: number;
  indexedBytes: number;
  usage: UsageTotals;
  usageByModel: ModelUsage[];
  codeChanges: CodeChanges;
  sessionsWithUnrecordedUsage: number;
  sessionsWithoutAiCredits: number;
  repositories: { repository: string; count: number }[];
  models: { model: string; count: number }[];
  tools: { toolName: string; count: number; failures: number; medianDurationMs: number | null }[];
  monthly: { month: string; count: number }[];
  branches: { branch: string; count: number }[];
}

export interface Facets {
  repositories: string[];
  branches: string[];
  models: string[];
}

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

export const api = {
  facets: () => get<Facets>("/api/facets"),
  stats: (params: Record<string, string | number | undefined>) => get<Stats>("/api/stats", params),
  sessions: (params: Record<string, string | number | undefined>) =>
    get<{ total: number; sessions: SessionSummary[] }>("/api/sessions", params),
  search: (params: Record<string, string | number | undefined>) => get<SearchResult>("/api/search", params),
  session: (id: string) => get<SessionDetail>(`/api/sessions/${id}`),
  timeline: (id: string, params: Record<string, string | number | undefined>) =>
    get<{ entries: TimelineEntry[] }>(`/api/sessions/${id}/timeline`, params),
};

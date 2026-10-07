import type { Database } from "./sqlite";
import { likePattern, parseQuery, type ParsedQuery } from "./fts";
import { makeSnippet, type Snippet } from "./snippet";

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

export interface SessionFilters {
  repository?: string;
  branch?: string;
  model?: string;
  from?: string;
  to?: string;
  /** Skip sessions that were opened but never used. */
  nonEmpty?: boolean;
}

export interface ListOptions extends SessionFilters {
  limit?: number;
  offset?: number;
  sort?: "recent" | "oldest" | "longest" | "busiest";
}

type Row = Record<string, unknown>;

function toSummary(row: Row): SessionSummary {
  let models: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(row.models ?? "[]"));
    if (Array.isArray(parsed)) models = parsed.filter((m): m is string => typeof m === "string");
  } catch {
    models = [];
  }
  return {
    id: String(row.id),
    name: (row.name as string) ?? null,
    summary: (row.summary as string) ?? null,
    repository: (row.repository as string) ?? null,
    branch: (row.branch as string) ?? null,
    cwd: (row.cwd as string) ?? null,
    models,
    createdAt: (row.created_at as string) ?? null,
    updatedAt: (row.updated_at as string) ?? null,
    durationMs: (row.duration_ms as number) ?? null,
    userMessageCount: Number(row.user_message_count ?? 0),
    assistantMessageCount: Number(row.assistant_message_count ?? 0),
    toolCallCount: Number(row.tool_call_count ?? 0),
    fileCount: Number(row.file_count ?? 0),
    artifactCount: Number(row.artifact_count ?? 0),
  };
}

const SESSION_COLUMNS = `
  s.id, s.name, s.summary, s.repository, s.branch, s.cwd, s.models,
  s.created_at, s.updated_at, s.duration_ms, s.user_message_count,
  s.assistant_message_count, s.tool_call_count, s.file_count, s.artifact_count
`;

const ORDER_BY: Record<NonNullable<ListOptions["sort"]>, string> = {
  recent: "s.updated_at DESC, s.id",
  oldest: "s.updated_at ASC, s.id",
  longest: "s.duration_ms DESC NULLS LAST, s.id",
  busiest: "s.tool_call_count DESC, s.id",
};

function filterClauses(filters: SessionFilters): { sql: string[]; params: (string | number)[] } {
  const sql: string[] = [];
  const params: (string | number)[] = [];
  if (filters.repository) {
    sql.push("s.repository = ?");
    params.push(filters.repository);
  }
  if (filters.branch) {
    sql.push("s.branch = ?");
    params.push(filters.branch);
  }
  if (filters.model) {
    sql.push("EXISTS (SELECT 1 FROM json_each(s.models) WHERE json_each.value = ?)");
    params.push(filters.model);
  }
  if (filters.from) {
    sql.push("s.updated_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    sql.push("s.updated_at <= ?");
    params.push(filters.to);
  }
  if (filters.nonEmpty) {
    sql.push("(s.user_message_count > 0 OR s.tool_call_count > 0)");
  }
  return { sql, params };
}

export function listSessions(
  db: Database,
  options: ListOptions = {},
): { total: number; sessions: SessionSummary[] } {
  const { sql, params } = filterClauses(options);
  const where = sql.length > 0 ? `WHERE ${sql.join(" AND ")}` : "";
  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM sessions s ${where}`).get(...params) as Row).n,
  );
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = db
    .prepare(
      `SELECT ${SESSION_COLUMNS} FROM sessions s ${where}
       ORDER BY ${ORDER_BY[options.sort ?? "recent"]} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Row[];
  return { total, sessions: rows.map(toSummary) };
}

export type SearchScope = "all" | "user" | "assistant" | "artifact" | "file";

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
  /** Terms matched by LIKE because they are too short for the trigram index. */
  fallbackTerms: string[];
}

interface QueryPart {
  sql: string;
  params: (string | number)[];
}

/**
 * Builds the WHERE predicates for one searchable text column. Long terms go
 * through the FTS index; short ones degrade to LIKE on the same rows.
 */
function textPredicates(
  parsed: ParsedQuery,
  ftsTable: string,
  idColumn: string,
  textColumn: string,
): QueryPart {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (parsed.match !== null) {
    clauses.push(`${idColumn} IN (SELECT rowid FROM ${ftsTable} WHERE ${ftsTable} MATCH ?)`);
    params.push(parsed.match);
  }
  for (const term of parsed.likeTerms) {
    clauses.push(`${textColumn} LIKE ? ESCAPE '\\'`);
    params.push(likePattern(term));
  }
  return { sql: clauses.join(" AND "), params };
}

/**
 * Full-text search across messages, generated artifacts and touched file paths.
 * Rows are ordered by FTS relevance when the index was usable, and by recency
 * otherwise; snippets are always built in JS so LIKE matches highlight too.
 */
export function search(
  db: Database,
  query: string,
  options: ListOptions & { scope?: SearchScope } = {},
): SearchResult {
  const parsed = parseQuery(query);
  if (!parsed) return { hits: [], total: 0, fallbackTerms: [] };

  const scope = options.scope ?? "all";
  const { sql: filterSql, params: filterParams } = filterClauses(options);
  const filterWhere = filterSql.length > 0 ? `AND ${filterSql.join(" AND ")}` : "";
  const rankExpr = (table: string, idColumn: string) =>
    parsed.match !== null
      ? `(SELECT bm25(${table}) FROM ${table} WHERE ${table} MATCH ? AND rowid = ${idColumn})`
      : "0.0";

  const parts: QueryPart[] = [];

  if (scope === "all" || scope === "user" || scope === "assistant") {
    const roleClause =
      scope === "user"
        ? "AND m.role = 'user' AND m.source IS NULL"
        : scope === "assistant"
          ? "AND m.role = 'assistant'"
          : "";
    const pred = textPredicates(parsed, "messages_fts", "m.id", "m.content");
    const rankParams = parsed.match !== null ? [parsed.match] : [];
    parts.push({
      sql: `SELECT 'message' AS kind, m.role AS role, m.timestamp AS timestamp, m.seq AS seq,
                   m.content AS text,
                   ${rankExpr("messages_fts", "m.id")} AS rank, m.session_id AS session_id
            FROM messages m
            JOIN sessions s ON s.id = m.session_id
            WHERE ${pred.sql} ${roleClause} ${filterWhere}`,
      params: [...rankParams, ...pred.params, ...filterParams],
    });
  }

  if (scope === "all" || scope === "artifact") {
    const artifactText = "COALESCE(a.title || char(10), '') || a.body";
    const pred = textPredicates(parsed, "artifacts_fts", "a.id", artifactText);
    const rankParams = parsed.match !== null ? [parsed.match] : [];
    parts.push({
      sql: `SELECT 'artifact' AS kind, a.kind AS role, NULL AS timestamp, a.ordinal AS seq,
                   ${artifactText} AS text,
                   ${rankExpr("artifacts_fts", "a.id")} AS rank, a.session_id AS session_id
            FROM artifacts a
            JOIN sessions s ON s.id = a.session_id
            WHERE ${pred.sql} ${filterWhere}`,
      params: [...rankParams, ...pred.params, ...filterParams],
    });
  }

  if (scope === "all" || scope === "file") {
    const clauses = parsed.terms.map(() => "f.file_path LIKE ? ESCAPE '\\'");
    parts.push({
      sql: `SELECT 'file' AS kind, f.tool_name AS role, NULL AS timestamp, NULL AS seq,
                   f.file_path AS text,
                   0.0 AS rank, f.session_id AS session_id
            FROM session_files f
            JOIN sessions s ON s.id = f.session_id
            WHERE ${clauses.join(" AND ")} ${filterWhere}`,
      params: [...parsed.terms.map(likePattern), ...filterParams],
    });
  }

  const union = parts.map((p) => p.sql).join("\nUNION ALL\n");
  const unionParams = parts.flatMap((p) => p.params);

  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM (${union})`).get(...unionParams) as Row).n,
  );

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = db
    .prepare(
      `SELECT h.kind, h.role, h.timestamp, h.seq, h.text, h.rank, ${SESSION_COLUMNS}
       FROM (${union}) h
       JOIN sessions s ON s.id = h.session_id
       ORDER BY h.rank ASC, s.updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...unionParams, limit, offset) as Row[];

  return {
    total,
    fallbackTerms: parsed.likeTerms,
    hits: rows.map((row) => ({
      session: toSummary(row),
      kind: row.kind as SearchHit["kind"],
      role: (row.role as string) ?? null,
      snippet: makeSnippet(String(row.text ?? ""), parsed.terms),
      timestamp: (row.timestamp as string) ?? null,
      seq: row.seq === null || row.seq === undefined ? null : Number(row.seq),
    })),
  };
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
}

export function getSession(db: Database, id: string): SessionDetail | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
  if (!row) return null;

  const artifacts = (
    db
      .prepare("SELECT kind, ordinal, title, body FROM artifacts WHERE session_id = ? ORDER BY kind, ordinal")
      .all(id) as Row[]
  ).map((a) => ({
    kind: String(a.kind),
    ordinal: Number(a.ordinal),
    title: (a.title as string) ?? null,
    body: String(a.body),
  }));

  const files = (
    db
      .prepare(
        "SELECT file_path, tool_name, touch_count FROM session_files WHERE session_id = ? ORDER BY touch_count DESC, file_path",
      )
      .all(id) as Row[]
  ).map((f) => ({
    path: String(f.file_path),
    toolName: (f.tool_name as string) ?? null,
    touchCount: Number(f.touch_count),
  }));

  const toolUsage = (
    db
      .prepare(
        `SELECT tool_name, COUNT(*) AS count, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures
         FROM tool_calls WHERE session_id = ? GROUP BY tool_name ORDER BY count DESC`,
      )
      .all(id) as Row[]
  ).map((t) => ({
    toolName: String(t.tool_name),
    count: Number(t.count),
    failures: Number(t.failures ?? 0),
  }));

  return {
    session: {
      ...toSummary(row),
      hostType: (row.host_type as string) ?? null,
      gitRoot: (row.git_root as string) ?? null,
      headCommit: (row.head_commit as string) ?? null,
      copilotVersion: (row.copilot_version as string) ?? null,
      startedAt: (row.started_at as string) ?? null,
      endedAt: (row.ended_at as string) ?? null,
      malformedLines: Number(row.malformed_lines ?? 0),
      dirPath: String(row.dir_path),
    },
    artifacts,
    files,
    toolUsage,
  };
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

export interface TimelineOptions {
  includeTools?: boolean;
  includeSubagent?: boolean;
  includeInjected?: boolean;
}

export function getTimeline(
  db: Database,
  id: string,
  options: TimelineOptions = {},
): TimelineEntry[] {
  const includeTools = options.includeTools ?? true;
  const includeSubagent = options.includeSubagent ?? false;
  const includeInjected = options.includeInjected ?? false;

  const clauses = ["session_id = ?"];
  if (!includeSubagent) clauses.push("is_subagent = 0");
  if (!includeInjected) clauses.push("(role = 'assistant' OR source IS NULL)");

  const messages = (
    db
      .prepare(
        `SELECT seq, role, content, timestamp, source, agent_mode, model, is_subagent
         FROM messages WHERE ${clauses.join(" AND ")} ORDER BY seq`,
      )
      .all(id) as Row[]
  ).map(
    (m): TimelineEntry => ({
      kind: "message",
      seq: Number(m.seq),
      role: String(m.role),
      content: String(m.content),
      timestamp: (m.timestamp as string) ?? null,
      source: (m.source as string) ?? null,
      agentMode: (m.agent_mode as string) ?? null,
      model: (m.model as string) ?? null,
      isSubagent: Number(m.is_subagent) === 1,
    }),
  );

  if (!includeTools) return messages;

  const tools = (
    db
      .prepare("SELECT seq, tool_name, target, success, timestamp FROM tool_calls WHERE session_id = ? ORDER BY seq")
      .all(id) as Row[]
  ).map(
    (t): TimelineEntry => ({
      kind: "tool",
      seq: Number(t.seq),
      toolName: String(t.tool_name),
      target: (t.target as string) ?? null,
      success: t.success === null || t.success === undefined ? null : Number(t.success),
      timestamp: (t.timestamp as string) ?? null,
    }),
  );

  return [...messages, ...tools].sort((a, b) => a.seq - b.seq);
}

export interface Stats {
  sessionCount: number;
  messageCount: number;
  toolCallCount: number;
  indexedBytes: number;
  repositories: { repository: string; count: number }[];
  models: { model: string; count: number }[];
  tools: { toolName: string; count: number; failures: number }[];
  monthly: { month: string; count: number }[];
  branches: { branch: string; count: number }[];
}

export function getStats(db: Database): Stats {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS sessions,
              COALESCE(SUM(user_message_count + assistant_message_count), 0) AS messages,
              COALESCE(SUM(tool_call_count), 0) AS tools,
              COALESCE(SUM(source_size), 0) AS bytes
       FROM sessions`,
    )
    .get() as Row;

  const repositories = (
    db
      .prepare(
        `SELECT repository, COUNT(*) AS count FROM sessions
         WHERE repository IS NOT NULL GROUP BY repository ORDER BY count DESC LIMIT 30`,
      )
      .all() as Row[]
  ).map((r) => ({ repository: String(r.repository), count: Number(r.count) }));

  const models = (
    db
      .prepare(
        `SELECT json_each.value AS model, COUNT(*) AS count
         FROM sessions, json_each(sessions.models)
         GROUP BY model ORDER BY count DESC LIMIT 30`,
      )
      .all() as Row[]
  ).map((r) => ({ model: String(r.model), count: Number(r.count) }));

  const tools = (
    db
      .prepare(
        `SELECT tool_name, COUNT(*) AS count, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures
         FROM tool_calls GROUP BY tool_name ORDER BY count DESC LIMIT 30`,
      )
      .all() as Row[]
  ).map((r) => ({ toolName: String(r.tool_name), count: Number(r.count), failures: Number(r.failures ?? 0) }));

  const monthly = (
    db
      .prepare(
        `SELECT substr(COALESCE(created_at, updated_at), 1, 7) AS month, COUNT(*) AS count
         FROM sessions WHERE month IS NOT NULL GROUP BY month ORDER BY month`,
      )
      .all() as Row[]
  ).map((r) => ({ month: String(r.month), count: Number(r.count) }));

  const branches = (
    db
      .prepare(
        `SELECT branch, COUNT(*) AS count FROM sessions
         WHERE branch IS NOT NULL GROUP BY branch ORDER BY count DESC LIMIT 30`,
      )
      .all() as Row[]
  ).map((r) => ({ branch: String(r.branch), count: Number(r.count) }));

  return {
    sessionCount: Number(totals.sessions ?? 0),
    messageCount: Number(totals.messages ?? 0),
    toolCallCount: Number(totals.tools ?? 0),
    indexedBytes: Number(totals.bytes ?? 0),
    repositories,
    models,
    tools,
    monthly,
    branches,
  };
}

export function getFacets(db: Database): { repositories: string[]; branches: string[]; models: string[] } {
  const repositories = (
    db
      .prepare("SELECT DISTINCT repository FROM sessions WHERE repository IS NOT NULL ORDER BY repository")
      .all() as Row[]
  ).map((r) => String(r.repository));
  const branches = (
    db.prepare("SELECT DISTINCT branch FROM sessions WHERE branch IS NOT NULL ORDER BY branch").all() as Row[]
  ).map((r) => String(r.branch));
  const models = (
    db
      .prepare("SELECT DISTINCT json_each.value AS model FROM sessions, json_each(sessions.models) ORDER BY model")
      .all() as Row[]
  ).map((r) => String(r.model));
  return { repositories, branches, models };
}

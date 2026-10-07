import type { Database, Statement } from "./sqlite";
import type { ParsedEvents, ParsedArtifact, SessionWorkspace } from "../types";

export interface SessionInput {
  id: string;
  dirPath: string;
  workspace: SessionWorkspace | null;
  events: ParsedEvents;
  extraArtifacts: ParsedArtifact[];
  sourceSize: number;
  sourceMtime: number;
}

export interface IndexWriter {
  write(input: SessionInput): void;
  remove(sessionId: string): void;
  knownSources(): Map<string, { size: number; mtime: number }>;
}

function durationMs(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export function createWriter(db: Database): IndexWriter {
  const stmts = {
    deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
    deleteMessages: db.prepare("DELETE FROM messages WHERE session_id = ?"),
    deleteTools: db.prepare("DELETE FROM tool_calls WHERE session_id = ?"),
    deleteArtifacts: db.prepare("DELETE FROM artifacts WHERE session_id = ?"),
    deleteFiles: db.prepare("DELETE FROM session_files WHERE session_id = ?"),
    insertSession: db.prepare(`
      INSERT INTO sessions (
        id, dir_path, name, summary, repository, host_type, branch, cwd, git_root,
        head_commit, copilot_version, models, created_at, updated_at, started_at, ended_at,
        duration_ms, user_message_count, assistant_message_count, tool_call_count,
        file_count, artifact_count, malformed_lines, source_size, source_mtime, indexed_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `),
    insertMessage: db.prepare(`
      INSERT INTO messages (session_id, seq, role, content, timestamp, source, agent_mode, model, is_subagent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertTool: db.prepare(`
      INSERT INTO tool_calls (session_id, seq, tool_name, target, success, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    insertArtifact: db.prepare(`
      INSERT INTO artifacts (session_id, kind, ordinal, title, body) VALUES (?, ?, ?, ?, ?)
    `),
    insertFile: db.prepare(`
      INSERT INTO session_files (session_id, file_path, tool_name, touch_count) VALUES (?, ?, ?, 1)
      ON CONFLICT(session_id, file_path) DO UPDATE SET touch_count = touch_count + 1
    `),
  } satisfies Record<string, Statement>;

  function removeSession(sessionId: string): void {
    stmts.deleteMessages.run(sessionId);
    stmts.deleteTools.run(sessionId);
    stmts.deleteArtifacts.run(sessionId);
    stmts.deleteFiles.run(sessionId);
    stmts.deleteSession.run(sessionId);
  }

  return {
    remove: removeSession,

    knownSources() {
      const rows = db
        .prepare("SELECT id, source_size AS size, source_mtime AS mtime FROM sessions")
        .all() as { id: string; size: number; mtime: number }[];
      return new Map(rows.map((r) => [r.id, { size: r.size, mtime: r.mtime }]));
    },

    write(input) {
      const { id, dirPath, workspace, events, extraArtifacts, sourceSize, sourceMtime } = input;
      removeSession(id);

      const artifacts = [...events.artifacts, ...extraArtifacts];
      const userCount = events.messages.filter((m) => m.role === "user" && m.source === null).length;
      const assistantCount = events.messages.filter((m) => m.role === "assistant").length;
      const uniqueFiles = new Set(events.files.map((f) => f.path));

      stmts.insertSession.run(
        id,
        dirPath,
        workspace?.name ?? null,
        workspace?.summary ?? null,
        workspace?.repository ?? events.context.repository ?? null,
        workspace?.hostType ?? events.context.hostType ?? null,
        workspace?.branch ?? events.context.branch ?? null,
        workspace?.cwd ?? events.context.cwd ?? null,
        workspace?.gitRoot ?? events.context.gitRoot ?? null,
        events.headCommit,
        events.copilotVersion,
        JSON.stringify(events.models),
        workspace?.createdAt ?? events.startedAt ?? null,
        workspace?.updatedAt ?? events.endedAt ?? null,
        events.startedAt,
        events.endedAt,
        durationMs(events.startedAt, events.endedAt),
        userCount,
        assistantCount,
        events.toolCalls.length,
        uniqueFiles.size,
        artifacts.length,
        events.malformedLines,
        sourceSize,
        sourceMtime,
        new Date().toISOString(),
      );

      for (const m of events.messages) {
        stmts.insertMessage.run(
          id,
          m.seq,
          m.role,
          m.content,
          m.timestamp,
          m.source,
          m.agentMode,
          m.model,
          m.isSubagent ? 1 : 0,
        );
      }
      for (const t of events.toolCalls) {
        stmts.insertTool.run(id, t.seq, t.toolName, t.target, t.success, t.timestamp);
      }
      for (const a of artifacts) {
        stmts.insertArtifact.run(id, a.kind, a.ordinal, a.title, a.body);
      }
      for (const f of events.files) {
        stmts.insertFile.run(id, f.path, f.toolName);
      }
    },
  };
}

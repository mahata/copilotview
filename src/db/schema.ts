import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type Database } from "./sqlite";

export const SCHEMA_VERSION = 2;

/**
 * `trigram` is the only built-in tokenizer that indexes Japanese text, since
 * `unicode61` treats a whole CJK run as a single token.
 */
const TOKENIZER = "trigram remove_diacritics 1";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  dir_path TEXT NOT NULL,
  name TEXT,
  summary TEXT,
  repository TEXT,
  host_type TEXT,
  branch TEXT,
  cwd TEXT,
  git_root TEXT,
  head_commit TEXT,
  copilot_version TEXT,
  models TEXT NOT NULL DEFAULT '[]',
  created_at TEXT,
  updated_at TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER,
  user_message_count INTEGER NOT NULL DEFAULT 0,
  assistant_message_count INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  artifact_count INTEGER NOT NULL DEFAULT 0,
  malformed_lines INTEGER NOT NULL DEFAULT 0,
  source_size INTEGER NOT NULL DEFAULT 0,
  source_mtime INTEGER NOT NULL DEFAULT 0,
  source_fingerprint TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_repository ON sessions(repository);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_branch ON sessions(branch);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT,
  source TEXT,
  agent_mode TEXT,
  model TEXT,
  is_subagent INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);

CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  target TEXT,
  success INTEGER,
  timestamp TEXT
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  title TEXT,
  body TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id, kind, ordinal);

CREATE TABLE IF NOT EXISTS session_files (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  tool_name TEXT,
  touch_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_session_files_path ON session_files(file_path);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='id',
  tokenize='${TOKENIZER}'
);

CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
  title,
  body,
  content='artifacts',
  content_rowid='id',
  tokenize='${TOKENIZER}'
);

CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS artifacts_fts_ai AFTER INSERT ON artifacts BEGIN
  INSERT INTO artifacts_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;

CREATE TRIGGER IF NOT EXISTS artifacts_fts_ad AFTER DELETE ON artifacts BEGIN
  INSERT INTO artifacts_fts(artifacts_fts, rowid, title, body)
  VALUES ('delete', old.id, old.title, old.body);
END;
`;

export function openDatabase(indexPath: string): Database {
  if (indexPath !== ":memory:") {
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  }
  const db = new DatabaseSync(indexPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function currentVersion(db: Database): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : 0;
}

/**
 * Creates the schema when absent. A version bump drops every indexed table so
 * the next run re-reads `session-state/` from scratch; the source files are the
 * only durable state, so discarding the index is always safe.
 */
export function migrate(db: Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const version = currentVersion(db);
  if (version !== 0 && version !== SCHEMA_VERSION) {
    for (const table of [
      "messages_fts",
      "artifacts_fts",
      "session_files",
      "artifacts",
      "tool_calls",
      "messages",
      "sessions",
    ]) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  }
  db.exec(SCHEMA);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(
    String(SCHEMA_VERSION),
  );
}

export function openIndex(indexPath: string): Database {
  const db = openDatabase(indexPath);
  migrate(db);
  return db;
}

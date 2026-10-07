import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Database } from "../db/sqlite";
import { createWriter } from "../db/write";
import { readCheckpoints, readPlan } from "./checkpoints";
import { parseEventsFile } from "./events";
import { parseWorkspaceYaml } from "./workspace";
import type { ParsedArtifact } from "../types";

export interface IndexProgress {
  scanned: number;
  total: number;
  indexed: number;
  skipped: number;
  removed: number;
  currentId: string;
}

export interface IndexOptions {
  force?: boolean;
  onProgress?: (progress: IndexProgress) => void;
  /** Commit every N sessions so a long run is resumable and memory stays flat. */
  batchSize?: number;
}

export interface IndexResult {
  total: number;
  indexed: number;
  skipped: number;
  removed: number;
  malformedLines: number;
  elapsedMs: number;
}

async function listSessionDirs(root: string): Promise<string[]> {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function sourceFingerprint(sessionDir: string): Promise<string> {
  const files = ["events.jsonl", "workspace.yaml", "plan.md"];
  const checkpointsDir = path.join(sessionDir, "checkpoints");
  try {
    const checkpointFiles = await fsp.readdir(checkpointsDir, { withFileTypes: true });
    for (const entry of checkpointFiles) {
      if (entry.isFile() || entry.isSymbolicLink()) files.push(path.join("checkpoints", entry.name));
    }
  } catch {
    // A session need not have checkpoints.
  }

  const hash = createHash("sha256");
  for (const relative of files.sort()) {
    try {
      const stat = await fsp.lstat(path.join(sessionDir, relative));
      hash.update(`${relative}\0${stat.size}\0${Math.floor(stat.mtimeMs)}\0`);
    } catch {
      hash.update(`${relative}\0missing\0`);
    }
  }
  return hash.digest("hex");
}

export async function indexSessions(
  db: Database,
  sessionStateDir: string,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const startedAt = Date.now();
  const writer = createWriter(db);
  const persisted = writer.knownSources();
  const known = options.force ? new Map() : persisted;
  const dirs = await listSessionDirs(sessionStateDir);
  const seen = new Set<string>();
  const batchSize = options.batchSize ?? 50;

  let indexed = 0;
  let skipped = 0;
  let malformedLines = 0;
  let scanned = 0;
  let inTransaction = false;

  const begin = () => {
    if (!inTransaction) {
      db.exec("BEGIN");
      inTransaction = true;
    }
  };
  const commit = () => {
    if (inTransaction) {
      db.exec("COMMIT");
      inTransaction = false;
    }
  };

  try {
    for (const id of dirs) {
      scanned += 1;
      const dirPath = path.join(sessionStateDir, id);
      const eventsPath = path.join(dirPath, "events.jsonl");

      let stat: fs.Stats;
      try {
        stat = await fsp.stat(eventsPath);
      } catch {
        // Sessions that never produced events (opened and abandoned) are skipped.
        continue;
      }

      seen.add(id);
      const size = stat.size;
      const mtime = Math.floor(stat.mtimeMs);
      const fingerprint = await sourceFingerprint(dirPath);
      const previous = known.get(id);
      if (previous && previous.fingerprint === fingerprint) {
        skipped += 1;
        options.onProgress?.({ scanned, total: dirs.length, indexed, skipped, removed: 0, currentId: id });
        continue;
      }

      const events = await parseEventsFile(eventsPath);
      malformedLines += events.malformedLines;

      let workspaceText: string | null = null;
      try {
        workspaceText = await fsp.readFile(path.join(dirPath, "workspace.yaml"), "utf8");
      } catch {
        workspaceText = null;
      }
      const workspace = workspaceText ? parseWorkspaceYaml(workspaceText, id) : null;

      const extraArtifacts: ParsedArtifact[] = await readCheckpoints(dirPath);
      const plan = await readPlan(dirPath);
      if (plan) extraArtifacts.push(plan);

      begin();
      writer.write({
        id,
        dirPath,
        workspace,
        events,
        extraArtifacts,
        sourceSize: size,
        sourceMtime: mtime,
        sourceFingerprint: fingerprint,
      });
      indexed += 1;

      if (indexed % batchSize === 0) commit();
      options.onProgress?.({ scanned, total: dirs.length, indexed, skipped, removed: 0, currentId: id });
    }

    let removed = 0;
    begin();
    for (const id of persisted.keys()) {
      if (!seen.has(id)) {
        writer.remove(id);
        removed += 1;
      }
    }
    commit();

    return {
      total: dirs.length,
      indexed,
      skipped,
      removed,
      malformedLines,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

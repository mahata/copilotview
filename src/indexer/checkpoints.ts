import fs from "node:fs/promises";
import path from "node:path";
import type { ParsedArtifact } from "../types";

const INDEX_ROW = /^\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(\S+\.md)\s*\|\s*$/;

export interface CheckpointIndexEntry {
  number: number;
  title: string;
  file: string;
}

/** Parses the Markdown table in `checkpoints/index.md`. */
export function parseCheckpointIndex(text: string): CheckpointIndexEntry[] {
  const entries: CheckpointIndexEntry[] = [];
  for (const line of text.split("\n")) {
    const match = INDEX_ROW.exec(line.trim());
    if (!match) continue;
    entries.push({ number: Number(match[1]), title: match[2]!, file: match[3]! });
  }
  return entries;
}

/**
 * Checkpoint bodies are XML-ish sections (`<overview>`, `<work_done>`, ...).
 * They are flattened into readable prose so the full text stays searchable.
 */
export function flattenCheckpointBody(text: string): string {
  const sections = [...text.matchAll(/<([a-z_]+)>\n?([\s\S]*?)\n?<\/\1>/g)];
  if (sections.length === 0) return text.trim();
  return sections
    .map(([, tag, body]) => `## ${tag!.replace(/_/g, " ")}\n\n${body!.trim()}`)
    .join("\n\n");
}

export async function readCheckpoints(sessionDir: string): Promise<ParsedArtifact[]> {
  const dir = path.join(sessionDir, "checkpoints");
  let indexText: string;
  try {
    indexText = await fs.readFile(path.join(dir, "index.md"), "utf8");
  } catch {
    return [];
  }
  const artifacts: ParsedArtifact[] = [];
  for (const entry of parseCheckpointIndex(indexText)) {
    let body: string;
    try {
      body = await fs.readFile(path.join(dir, entry.file), "utf8");
    } catch {
      continue;
    }
    artifacts.push({
      kind: "checkpoint",
      ordinal: entry.number,
      title: entry.title,
      body: flattenCheckpointBody(body),
    });
  }
  return artifacts;
}

/** Reads the session-scoped `plan.md`, if the session produced one. */
export async function readPlan(sessionDir: string): Promise<ParsedArtifact | null> {
  try {
    const body = await fs.readFile(path.join(sessionDir, "plan.md"), "utf8");
    if (body.trim().length === 0) return null;
    return { kind: "plan", ordinal: 0, title: "plan.md", body };
  } catch {
    return null;
  }
}

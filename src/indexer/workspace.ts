import { parse as parseYaml } from "yaml";
import type { SessionWorkspace } from "../types";

function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

/**
 * Parses a session's `workspace.yaml`. Returns null when the file does not
 * describe a session (missing id) or is not parseable.
 */
export function parseWorkspaceYaml(text: string, fallbackId: string): SessionWorkspace | null {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  const id = str(d.id) ?? fallbackId;
  if (!id) return null;
  return {
    id,
    cwd: str(d.cwd),
    gitRoot: str(d.git_root),
    repository: str(d.repository),
    hostType: str(d.host_type),
    branch: str(d.branch),
    name: str(d.name),
    summary: str(d.summary),
    userNamed: d.user_named === true,
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

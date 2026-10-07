import os from "node:os";
import path from "node:path";

export function defaultSessionStateDir(): string {
  return process.env.COPILOTVIEW_SESSION_STATE ?? path.join(os.homedir(), ".copilot", "session-state");
}

export function defaultIndexPath(): string {
  return process.env.COPILOTVIEW_INDEX ?? path.join(os.homedir(), ".copilotview", "index.db");
}

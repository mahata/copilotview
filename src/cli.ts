import { defaultIndexPath, defaultSessionStateDir } from "./paths";
import { openIndex } from "./db/schema";
import { indexSessions } from "./indexer/scan";
import { createApp } from "./server/app";

interface ParsedArgs {
  command: string;
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(arg.slice(2), next);
      i += 1;
    } else {
      flags.set(arg.slice(2), true);
    }
  }
  return { command, flags };
}

function flagString(flags: ParsedArgs["flags"], key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

const HELP = `copilotview — browse and search past Copilot CLI sessions

Usage:
  copilotview index [options]    Build or refresh the search index
  copilotview serve [options]    Start the local web UI
  copilotview stats [options]    Print index statistics

Options:
  --source <dir>   session-state directory (default: ~/.copilot/session-state)
  --index <file>   index database path (default: ~/.copilotview/index.db)
  --force          re-read every session instead of only changed ones
  --port <n>       port for serve (default: 4178)
  --host <addr>    bind address for serve (default: 127.0.0.1)
  --no-open        do not print the browser hint
`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

async function runIndex(flags: ParsedArgs["flags"]): Promise<void> {
  const source = flagString(flags, "source") ?? defaultSessionStateDir();
  const indexPath = flagString(flags, "index") ?? defaultIndexPath();
  const db = openIndex(indexPath);

  process.stdout.write(`Source: ${source}\nIndex:  ${indexPath}\n\n`);
  const isTty = process.stdout.isTTY === true;
  let lastRender = 0;

  const result = await indexSessions(db, source, {
    force: flags.get("force") === true,
    onProgress(progress) {
      if (!isTty) return;
      const now = Date.now();
      if (now - lastRender < 80) return;
      lastRender = now;
      const pct = Math.floor((progress.scanned / Math.max(progress.total, 1)) * 100);
      process.stdout.write(
        `\r\x1b[2K${pct}%  ${progress.scanned}/${progress.total}  indexed ${progress.indexed}  skipped ${progress.skipped}`,
      );
    },
  });
  if (isTty) process.stdout.write("\r\x1b[2K");

  process.stdout.write(
    [
      `Scanned ${result.total} directories in ${(result.elapsedMs / 1000).toFixed(1)}s`,
      `  indexed: ${result.indexed}`,
      `  skipped (unchanged): ${result.skipped}`,
      `  removed (deleted on disk): ${result.removed}`,
      result.malformedLines > 0 ? `  malformed log lines skipped: ${result.malformedLines}` : null,
      "",
    ]
      .filter((l) => l !== null)
      .join("\n"),
  );
  db.close();
}

async function runServe(flags: ParsedArgs["flags"]): Promise<void> {
  const indexPath = flagString(flags, "index") ?? defaultIndexPath();
  const port = Number(flagString(flags, "port") ?? 4178);
  const host = flagString(flags, "host") ?? "127.0.0.1";
  const db = openIndex(indexPath);

  const { sessionCount } = (await import("./db/query")).getStats(db);
  if (sessionCount === 0) {
    process.stdout.write("The index is empty. Run `copilotview index` first.\n");
  }

  const { serve } = await import("@hono/node-server");
  const app = createApp(db);
  const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    process.stdout.write(`copilotview serving ${sessionCount} sessions on http://${info.address}:${info.port}\n`);
  });

  const shutdown = () => {
    server.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function runStats(flags: ParsedArgs["flags"]): Promise<void> {
  const indexPath = flagString(flags, "index") ?? defaultIndexPath();
  const db = openIndex(indexPath);
  const { getStats } = await import("./db/query");
  const stats = getStats(db);
  process.stdout.write(
    [
      `Sessions:   ${stats.sessionCount}`,
      `Messages:   ${stats.messageCount}`,
      `Tool calls: ${stats.toolCallCount}`,
      `Source log: ${formatBytes(stats.indexedBytes)}`,
      "",
      "Top repositories:",
      ...stats.repositories.slice(0, 10).map((r) => `  ${String(r.count).padStart(5)}  ${r.repository}`),
      "",
      "Top models:",
      ...stats.models.slice(0, 10).map((m) => `  ${String(m.count).padStart(5)}  ${m.model}`),
      "",
      "Top tools:",
      ...stats.tools.slice(0, 10).map((t) => `  ${String(t.count).padStart(5)}  ${t.toolName}`),
      "",
    ].join("\n"),
  );
  db.close();
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "index":
      await runIndex(flags);
      break;
    case "serve":
      await runServe(flags);
      break;
    case "stats":
      await runStats(flags);
      break;
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      break;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

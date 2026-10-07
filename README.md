# copilotview

A local tool for searching, browsing, and getting an overview of your past GitHub Copilot CLI sessions stored in `~/.copilot/session-state/`.

It treats the source data as read-only and builds a search index at `~/.copilotview/index.db`. Nothing is sent to external services.

## Features

- **Full-text search** — Search across all sessions, optionally scoped to your messages, Copilot responses, plans and summaries, or file names. Filter by repository and model.
- **Session browsing** — View the conversation timeline, tool call log, files touched, plans, and completion reports.
- **Statistics** — See sessions by month and usage trends by repository, model, and tool.

copilotview does not call an LLM to produce summaries. Instead, it gathers and displays information each session already records: the `summary` field in `workspace.yaml`, completion reports, checkpoints, and aggregate counts.

## Requirements

Node.js 24 or later and [pnpm](https://pnpm.io/) 12. copilotview uses the built-in `node:sqlite` module, so there are no native modules to build.

## Setup

```bash
pnpm install
pnpm build
```

## Usage

```bash
# Build the index (later runs re-read only sessions that have changed)
node dist/cli.js index

# Start the web UI (http://127.0.0.1:4178)
node dist/cli.js serve

# Print a summary of the index
node dist/cli.js stats
```

### Options

| Option | Description |
| --- | --- |
| `--source <dir>` | Session-state directory (default: `~/.copilot/session-state`) |
| `--index <file>` | Index file path (default: `~/.copilotview/index.db`) |
| `--force` | Ignore change detection and re-read every session |
| `--port <n>` | Port for `serve` (default: 4178) |
| `--host <addr>` | Bind address for `serve` (default: `127.0.0.1`) |

You can also override the defaults with the `COPILOTVIEW_SESSION_STATE` and `COPILOTVIEW_INDEX` environment variables.

## How search works

Search uses SQLite FTS5 with the trigram tokenizer. This makes Japanese text searchable without word segmentation, but because the index is built from trigrams, **terms shorter than three characters can't be looked up in the index**. One- and two-character terms therefore fall back to a sequential `LIKE` scan, and the UI tells you when this happens. Separate multiple terms with spaces to combine them with AND.

## Development

```bash
pnpm test      # vitest
pnpm typecheck # tsc --noEmit
pnpm lint      # oxlint
pnpm dev:web   # Vite dev server (proxies API requests to serve on port 4178)
```

GitHub Actions runs lint, typecheck, tests, and the build on Node.js 24 and 26 for every pull request and push to `main`, then checks that the built CLI's `index`, `stats`, and `serve` commands work.

## Design notes

- The index stores only message text, plans, summaries, and file paths; **tool output is not stored**. As a result, 1.2 GB of source data fits in roughly 30 MB.
- When the schema changes, the index is discarded and rebuilt. This is safe because the source data is always left in place.
- copilotview does not read `~/.copilot/session-store.db`, because its schema is internal to Copilot and not public.

## License

MIT

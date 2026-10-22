# copilotview

A local tool for searching, browsing, and getting an overview of your past GitHub Copilot CLI sessions stored in `~/.copilot/session-state/`.

It treats the source data as read-only and builds a search index at `~/.copilotview/index.db`. Nothing is sent to external services.

## Features

- **Full-text search** — Search across all sessions, optionally scoped to your messages, Copilot responses, plans and summaries, or file names. Filter by repository, model, and period, from the past 24 hours to the past year.
- **Session browsing** — View the conversation timeline, tool call log, files touched, plans, and completion reports.
- **Statistics** — See sessions by month and usage trends by repository, model, and tool, across the complete index or the same periods as search.

copilotview does not call an LLM to produce summaries. Instead, it gathers and displays information each session already records: the `summary` field in `workspace.yaml`, completion reports, checkpoints, and aggregate counts.

## Installation

### Homebrew

```bash
brew install mahata/tap/copilotview
```

Use the full name: Homebrew loads formulae from unofficial taps only after you trust them, and naming the formula in full trusts it. Homebrew installs Node.js as a dependency. Upgrade with `brew upgrade copilotview`.

### From source

Requires Node.js 24 or later and [pnpm](https://pnpm.io/) 12. copilotview uses the built-in `node:sqlite` module, so there are no native modules to build.

```bash
pnpm install
pnpm build
```

Then run `node dist/cli.js` wherever the examples below use `copilotview`. A build from source reports its version as `0.0.0-dev`, because only release tarballs record a version.

## Usage

```bash
# Update the index, then start the web UI (http://127.0.0.1:4178)
copilotview serve

# Update the index without starting the web UI
copilotview index

# Print a summary of the index
copilotview stats

# Print the version (same as `copilotview --version`)
copilotview version
```

`serve` and `index` re-read only the sessions that have changed since the last update, so only the first run takes noticeable time. If `serve` can't update the index, for example because the session-state directory doesn't exist, it prints a warning and serves the index as it is. Sessions that change while `serve` is running appear once you run `copilotview index` or restart `serve`.

`cv` is installed alongside `copilotview` as a shorter alias, so `cv serve` works too.

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

The period filter compares the time shown on each result: the time a message was sent for message matches, and the session's last update for plan, summary, and file name matches and for the session list.

The selected period also applies to the Statistics page. It counts sessions, along with their repositories, models, branches, and source data, by the session's last update, as the session list does, and Sessions by month still groups them by the month they were created. It counts messages by the time they were sent and tool calls by the time they were made.

## Development

```bash
pnpm test      # vitest
pnpm typecheck # tsc --noEmit
pnpm lint      # oxlint
pnpm dev:web   # Vite dev server (proxies API requests to serve on port 4178)
```

GitHub Actions runs lint, typecheck, tests, and the build on Node.js 24 and 26 for every pull request and push to `main`, then runs `scripts/smoke-test.sh` to check that the built CLI's `version`, `index`, `stats`, and `serve` commands work from another directory.

## Releasing

Releases are automatic. Every push to `main` runs the Release workflow, which runs the tests and builds the CLI and web UI. If the built `cli.js` or `web/` differs from the tarball of the newest published release, the workflow releases the next minor version: it takes the highest `vX.Y.Z` tag and bumps its minor version, so `v0.1.0` becomes `v0.2.0`. Pushes that leave the bundle unchanged, such as most Dependabot updates of development tools and changes to docs, tests, or CI, don't produce a release. A run whose commit is no longer the tip of `main` releases nothing and leaves the decision to the run for the newer commit, so re-running an old run never releases older code. Release versions live only in tags; the `version` in `package.json` is a placeholder.

To release a specific version instead, such as a new major version, wait for the Release run of the commit you want to tag to finish, then push the tag. If you push it while that run is still building, both runs may release the commit. Later automatic releases continue from the highest tag.

```bash
git tag v1.0.0
git push origin v1.0.0
```

A release packages the bundled CLI, web UI, LICENSE, README, and a `VERSION` file holding the version into `copilotview-<version>.tar.gz`, smoke-tests the packaged CLI, including that `copilotview --version` reports that version, and publishes a GitHub Release with the tarball and its `.sha256` checksum. The CLI reads its version from `VERSION` next to `cli.js` rather than having it built into the bundle, so the comparison with the previous release still treats an unchanged `cli.js` as unchanged. An automatic release creates its tag at the released commit just before publishing and fails if that tag already exists, for example because someone pushed it during the run; re-running it then picks the next free version. To build the same tarball in `release/` locally, run `RELEASE_TAG=v1.2.3 pnpm run package` after `pnpm build`.

After each release, the workflow updates the formula in [mahata/homebrew-tap](https://github.com/mahata/homebrew-tap): it renders `Formula/copilotview.rb` for the new tarball with `scripts/homebrew-formula.mjs`, installs, tests, and audits it with Homebrew, and only then pushes it. It refuses to replace a newer version in the tap with an older one. The push uses the `HOMEBREW_TAP_DEPLOY_KEY` Actions secret, which holds the private key of a deploy key with write access to the tap. To publish the formula again for the latest release, for example after changing the script or after a failed update, run the Homebrew tap workflow manually with that release's tag:

```bash
gh workflow run homebrew-tap.yml -f tag=v1.2.3
```

## Design notes

- The index stores only message text, plans, summaries, and file paths; **tool output is not stored**. As a result, 1.2 GB of source data fits in roughly 30 MB.
- When the schema changes, the index is discarded and rebuilt. This is safe because the source data is always left in place.
- copilotview does not read `~/.copilot/session-store.db`, because its schema is internal to Copilot and not public.

## License

MIT

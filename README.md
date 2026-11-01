# copilotview

A local tool for searching, browsing, and getting an overview of your past GitHub Copilot CLI and GitHub Copilot app sessions stored in `~/.copilot/session-state/`. The app runs the Copilot CLI for each of its sessions and chats, so they are recorded there in the same format as sessions you start in a terminal.

[Visit the website](https://copilotview.mahata.org/) for an introduction and installation guide.

It treats the source data as read-only and builds a search index at `~/.copilotview/index.db`. Nothing is sent to external services.

## Features

- **Full-text search** — Search across all sessions, optionally scoped to your messages, Copilot responses, plans and summaries, or file names. Filter by repository, model, and period: a preset from the past 24 hours to the past year, or a custom range of dates.
- **Session browsing** — View the conversation timeline, tool call log, files touched, plans, completion reports, and the session's AI credits, tokens, and lines changed.
- **Statistics** — See sessions by month; usage trends by repository, model, and tool; AI credits and tokens by model; lines added and removed; and median tool durations, across the complete index or the same periods as search.
- **Trends** — Chart AI credits, active sessions, and messages for the same periods by hour, day, week, or month, and see the AI credits each model used in any bar.

copilotview does not call an LLM to produce summaries. Instead, it gathers and displays information each session already records: the `summary` field in `workspace.yaml`, completion reports, checkpoints, the usage the CLI records, and aggregate counts.

## Installation

### Homebrew

```bash
brew install mahata/tap/copilotview
```

Use the full name: Homebrew loads formulae from unofficial taps only after you trust them, and naming the formula in full trusts it. Homebrew installs Node.js as a dependency. Upgrade with `brew upgrade copilotview`.

The formula also links `cv`, a shorter alias for `copilotview`. If Homebrew's `bin` directory already contains a `cv` from another source, linking fails and `copilotview` isn't linked either; run `brew link --overwrite copilotview` to replace that `cv`.

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

A custom range covers whole days in your browser's time zone, from the start of the first day through the end of the last. Leave either date empty to leave that end of the range open.

The selected period also applies to the Statistics page. It counts sessions, along with their repositories, models, branches, and source data, by the session's last update, as the session list does, and Sessions by month still groups them by the month they were created. It counts messages by the time they were sent and tool calls by the time they were made. Usage, lines changed, and tool durations follow the rules in [How usage is counted](#how-usage-is-counted).

The Trends page charts the selected period too, as described in [How trends are counted](#how-trends-are-counted).

## How usage is counted

When it exits, the CLI writes a `session.shutdown` event with the session's model calls, AI credits, tokens, and lines added and removed. Recent versions also write a `session.usage_record` event for each model call. copilotview takes the usage of each CLI run, from starting or resuming a session to exiting, from its usage records if the CLI wrote them, and otherwise from its shutdown event.

- AI credits are what the CLI recorded for each model call at the model's per-token prices, where 1 AI credit is $0.01 USD. They include the calls Copilot makes on its own while working on a prompt, including those of subagents, and the calls that compact a long conversation, which the CLI bills but leaves out of its model call and token counts. This matches the totals the CLI reports.
- CLI versions before 1.0.44 didn't record AI credits. copilotview doesn't estimate them from tokens, because prices and discounts change, so the session page shows such usage as not recorded, and the Statistics page shows how many sessions in the period it affects.
- Input tokens include cached input, so the Statistics page also shows the share of input tokens read from the cache.
- CLI 1.0.65 and earlier reset their counts when you resumed a session, while later versions carry them over. Shutdown events don't say which CLI wrote them, so copilotview tells the two apart by comparing the number of model calls in each run with the counts the event reports.
- A run that called a model but exited without writing either kind of event, typically because the CLI crashed or was killed, has no usage to count. The Statistics page shows how many sessions in the period this affects, and the session page notes it too.
- Lines added and removed are what the CLI reported in its last shutdown event, so they leave out changes from a run that is still going or that ended without one.
- A tool's duration runs from the start of a call to its completion, including any time spent waiting for your approval or answer. The Statistics page therefore shows each tool's median duration, which a few long waits don't skew.

With a period selected, usage counts by when it was recorded: the time of each call, or for usage taken from a shutdown event, the time the run ended. The number of sessions with usage recorded without AI credits counts the same way. Lines changed and the number of sessions with unrecorded usage count by the session's last update, as other session statistics do. Tool durations count by when the call was made.

## How trends are counted

The Trends page charts AI credits, active sessions, and messages over the selected period, up to now. With All time selected, it starts at the first activity in the index. Each bar covers a whole hour, day, week starting on Monday, or month in your browser's time zone, so the first and last bars can include activity from just before or after the period. Days, weeks, and months follow your clock when daylight saving time starts or ends, while every hour lasts an hour.

Auto picks the finest interval that charts the period in about 100 bars or fewer: hours for up to four days, days for up to about three months, weeks for up to almost two years, and months for anything longer. If you pick an interval that would need more than 400 bars, the page uses the next coarser one and says so.

- A session is active in a bar if it has a message from you, a Copilot response, a tool call, or a model call in it. The totals count each session once, however many bars it's active in.
- Messages are your messages and Copilot's responses, counted by when they were sent, as on the Statistics page.
- AI credits and requests count by when they were recorded, as described in [How usage is counted](#how-usage-is-counted). Point at a bar, or focus the charts and use the arrow keys, to see its AI credits by model.
- Messages, tool calls, and usage without a recorded time count at the session's last update.

When the bars line up with the period, as days do with a custom range, the totals of messages, requests, and AI credits match the Statistics page.

## Development

```bash
pnpm test      # vitest
pnpm typecheck # tsc --noEmit
pnpm lint      # oxlint
pnpm dev:web   # Vite dev server (proxies API requests to serve on port 4178)
```

GitHub Actions runs lint, typecheck, tests, and the build on Node.js 24 and 26 for every pull request and push to `main`, then runs `scripts/smoke-test.sh` to check that the built CLI's `version`, `index`, `stats`, and `serve` commands work from another directory.

### Website

The public introduction at [copilotview.mahata.org](https://copilotview.mahata.org/) lives in `site/`. It is plain HTML and CSS, separate from the React application in `web/`, and needs no build. To preview it with Python:

```bash
python3 -m http.server 8080 --bind 127.0.0.1 --directory site
```

Open `http://127.0.0.1:8080`. Keep local asset paths relative so the same files work at the domain root, in local previews, and under the `/copilotview/` project path. The illustration uses sample content, never real session data.

The Pages workflow deploys only `site/` when that directory or `.github/workflows/pages.yml` changes on `main`. It can also be run manually from `main`. Repository Settings > Pages must use **GitHub Actions** as the source. Website-only changes do not alter the application bundle or trigger a new application release.

The custom domain `copilotview.mahata.org` is set in repository Settings > Pages, not in a `CNAME` file, which GitHub ignores for Actions deployments. Cloudflare's `mahata.org` zone points it at GitHub Pages with this record:

| Type | Name | Target | Proxy status | TTL |
| --- | --- | --- | --- | --- |
| CNAME | `copilotview` | `mahata.github.io` | DNS only | Auto |

Keep the record DNS only: GitHub checks that the name resolves to Pages and issues the HTTPS certificate itself. **Enforce HTTPS** is enabled, and `https://mahata.github.io/copilotview/` redirects to the custom domain. If the custom domain is ever removed from Pages, delete the DNS record too, so that no other Pages site can claim the name.

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

- The index stores only message text, plans, summaries, file paths, and usage counts; **tool output is not stored**. As a result, 1.2 GB of source data fits in roughly 30 MB.
- The index also totals each session's activity by quarter hour, so the Trends page reads one small table instead of every message and model call. On an index of 22,700 sessions, a year of daily bars takes about 50 ms. Every UTC offset in use is a whole number of quarter hours, so these totals add up exactly to the hours, days, weeks, and months of any time zone.
- When the schema changes, the index is discarded and rebuilt. This is safe because the source data is always left in place.
- When copilotview indexes every session — on the first run, after a schema change, or with `--force` — it builds the full-text index in one pass after writing the sessions, which takes about half as long as updating it session by session. Such a run is a single transaction: if it's interrupted, the index stays as it was, and the next run starts over.
- copilotview does not read `~/.copilot/session-store.db`, because its schema is internal to Copilot and not public.

## License

MIT

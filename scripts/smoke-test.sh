#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: $0 <path/to/cli.js> [expected-version]" >&2
  exit 2
fi

cli_path="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
expected_version="${2:-}"
port="${SMOKE_TEST_PORT:-4178}"
base_url="http://127.0.0.1:$port"
work_dir="$(mktemp -d)"
server_pid=""

cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

mkdir "$work_dir/session-state"
cd "$work_dir"
version_output="$(node "$cli_path" --version)"
echo "$version_output"
if [ "$(node "$cli_path" version)" != "$version_output" ]; then
  echo "copilotview version and copilotview --version disagree." >&2
  exit 1
fi
if [ -n "$expected_version" ] && [ "$version_output" != "copilotview $expected_version" ]; then
  echo "Expected copilotview $expected_version, but the CLI reports: $version_output" >&2
  exit 1
fi
node "$cli_path" index --source "$work_dir/session-state" --index "$work_dir/index.db"
node "$cli_path" stats --index "$work_dir/index.db"
node "$cli_path" serve --source "$work_dir/session-state" --index "$work_dir/index.db" --port "$port" &
server_pid=$!
curl -fsS --retry 10 --retry-connrefused --retry-delay 1 "$base_url/api/stats"
echo
asset_path="$(curl -fsS "$base_url/" | grep -o -m1 '/assets/[^"]*\.js')"
# Unknown paths fall back to index.html, so a 200 alone doesn't prove static serving works.
curl -fsS -o /dev/null -w '%{content_type}\n' "$base_url$asset_path" | grep javascript

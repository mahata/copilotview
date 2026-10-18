#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <path/to/cli.js>" >&2
  exit 2
fi

cli_path="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
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
node "$cli_path" index --source "$work_dir/session-state" --index "$work_dir/index.db"
node "$cli_path" stats --index "$work_dir/index.db"
node "$cli_path" serve --index "$work_dir/index.db" --port "$port" &
server_pid=$!
curl -fsS --retry 10 --retry-connrefused --retry-delay 1 "$base_url/api/stats"
echo
asset_path="$(curl -fsS "$base_url/" | grep -o -m1 '/assets/[^"]*\.js')"
# Unknown paths fall back to index.html, so a 200 alone doesn't prove static serving works.
curl -fsS -o /dev/null -w '%{content_type}\n' "$base_url$asset_path" | grep javascript

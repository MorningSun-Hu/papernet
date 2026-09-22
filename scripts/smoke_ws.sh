#!/usr/bin/env bash
set -euo pipefail

# 100 WS heartbeat smoke. tempfile / TMPDIR only; does not write host data dirs.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -z "${TMPDIR:-}" ]; then
    TMPDIR="$(mktemp -d)"
    export TMPDIR
fi

export CARGO_TERM_COLOR="${CARGO_TERM_COLOR:-always}"

exec cargo test -p papernet-teacher --test p5_capacity ws_100_heartbeat -- --nocapture

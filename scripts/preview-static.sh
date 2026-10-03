#!/usr/bin/env bash
# Serve prebuilt /teacher/ and /student/ from papernet-teacher (no Vite).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PAPERNET_BIND="${PAPERNET_BIND:-0.0.0.0:8088}"
export PAPERNET_DATA_DIR="${PAPERNET_DATA_DIR:-$ROOT/data}"

if [[ -z "${PAPERNET_UI_DIR:-}" ]]; then
  if [[ -f "$ROOT/deploy/runtime/teacher/index.html" ]]; then
    export PAPERNET_UI_DIR="$ROOT/deploy/runtime"
  elif [[ -f "$ROOT/dist/teacher/index.html" ]]; then
    export PAPERNET_UI_DIR="$ROOT/dist"
  else
    echo "没有找到静态页。先执行: bash scripts/build-web.sh" >&2
    exit 1
  fi
fi

BIN="${PAPERNET_TEACHER_BIN:-$ROOT/target/release/papernet-teacher}"
if [[ ! -x "$BIN" ]]; then
  echo "没有教师机程序: $BIN" >&2
  echo "先执行: /root/.cargo/bin/cargo build --release -p papernet-teacher" >&2
  exit 1
fi

echo "UI: $PAPERNET_UI_DIR"
echo "教师机 http://127.0.0.1:${PAPERNET_BIND##*:}/teacher/"
echo "学生机 http://127.0.0.1:${PAPERNET_BIND##*:}/student/"
exec "$BIN"

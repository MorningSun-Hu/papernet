#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${PAPERNET_UI_OUT:-$ROOT/dist}"

# Teacher static assets served at /teacher/
(
  cd "$ROOT/web/teacher"
  npx vite build --base /teacher/ --outDir "$OUT/teacher" --emptyOutDir
)

# Student static assets served at /student/
(
  cd "$ROOT/web/student"
  npx vite build --base /student/ --outDir "$OUT/student" --emptyOutDir
)

echo "UI built: $OUT/teacher  $OUT/student"

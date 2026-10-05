#!/usr/bin/env bash
# Build Linux teacher + static UI into deploy/runtime/ with 版本说明.txt.
set -euo pipefail

PAPERNET_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=pack-info.sh
source "$PAPERNET_ROOT/scripts/pack-info.sh"

CARGO="${CARGO:-/root/.cargo/bin/cargo}"
OUT="${PAPERNET_RUNTIME_OUT:-$PAPERNET_ROOT/deploy/runtime}"
VERSION="$(papernet_version)"

"$CARGO" build --release -p papernet-teacher
COMPILED_AT="$(papernet_now)"

bash "$PAPERNET_ROOT/scripts/build-web.sh"

mkdir -p "$OUT"
cp "$PAPERNET_ROOT/target/release/papernet-teacher" "$OUT/papernet-teacher"
mkdir -p "$OUT/teacher" "$OUT/student"
cp -a "$PAPERNET_ROOT/dist/teacher/." "$OUT/teacher/"
cp -a "$PAPERNET_ROOT/dist/student/." "$OUT/student/"

PACKED_AT="$(papernet_now)"
write_papernet_pack_info "$OUT/版本说明.txt" "$VERSION" "$COMPILED_AT" "$PACKED_AT" "Linux x86_64"

echo "Linux 运行包: $OUT"
echo "版本 $VERSION"

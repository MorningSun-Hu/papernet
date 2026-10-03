#!/usr/bin/env bash
# Cross-compile the teacher EXE and assemble a Windows classroom folder.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${PAPERNET_WINDOWS_TARGET:-x86_64-pc-windows-gnu}"
LINKER="${CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER:-x86_64-w64-mingw32-gcc-posix}"
OUT="${PAPERNET_WINDOWS_OUT:-$ROOT/deploy/windows}"
CARGO="${CARGO:-/root/.cargo/bin/cargo}"
RUSTUP="${RUSTUP:-/root/.cargo/bin/rustup}"

if ! command -v "$LINKER" >/dev/null 2>&1; then
  echo "缺少交叉编译器 $LINKER 。Debian/Ubuntu 安装: gcc-mingw-w64-x86-64" >&2
  exit 1
fi

export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="$LINKER"

"$RUSTUP" target add "$TARGET"
"$CARGO" build --release -p papernet-teacher --target "$TARGET"
bash "$ROOT/scripts/build-web.sh"

mkdir -p "$OUT"
cp "$ROOT/target/$TARGET/release/papernet-teacher.exe" "$OUT/papernet-teacher.exe"
mkdir -p "$OUT/teacher" "$OUT/student"
cp -a "$ROOT/dist/teacher/." "$OUT/teacher/"
cp -a "$ROOT/dist/student/." "$OUT/student/"

LIBGCC="$("$LINKER" -print-file-name=libgcc_s_seh-1.dll)"
if [[ -f "$LIBGCC" ]]; then
  cp "$LIBGCC" "$OUT/libgcc_s_seh-1.dll"
fi
PTHREAD="$("$LINKER" -print-file-name=libwinpthread-1.dll)"
if [[ ! -f "$PTHREAD" ]]; then
  PTHREAD="/usr/x86_64-w64-mingw32/lib/libwinpthread-1.dll"
fi
if [[ -f "$PTHREAD" ]]; then
  cp "$PTHREAD" "$OUT/libwinpthread-1.dll"
fi

# CRLF batch file; use goto instead of parenthesized if/else blocks.
python3 - "$OUT/启动教室.bat" <<'PY'
from pathlib import Path
import sys
text = """@echo off
cd /d "%~dp0"
set PAPERNET_BIND=0.0.0.0:8088
set PAPERNET_DATA_DIR=%~dp0data
set PAPERNET_UI_DIR=%~dp0
echo PaperNet 教室
echo 教师机  http://本机IP:8088/teacher/
echo 学生机  http://本机IP:8088/student/
echo 健康检查 http://本机IP:8088/api/v1/health
papernet-teacher.exe
if errorlevel 1 goto fail
goto end
:fail
echo 启动失败。可改 启动教室.bat 里的 PAPERNET_BIND 端口。
pause
:end
"""
Path(sys.argv[1]).write_bytes(text.replace("\n", "\r\n").encode("gbk", errors="replace"))
PY

python3 - "$OUT/使用说明.txt" <<'PY'
from pathlib import Path
import sys
text = """PaperNet 教室（Windows 教师机）

把本文件夹整份拷到教师电脑，不要只拷 exe。
双击「启动教室.bat」。
老师打开：http://本机IP:8088/teacher/
学生用浏览器打开：http://本机IP:8088/student/
两边必须同一主机名和同一端口。不要用 file:// 打开 HTML。

改端口：编辑 启动教室.bat 里的 PAPERNET_BIND，例如 0.0.0.0:18080，防火墙放行该 TCP 端口。
课堂数据在本文件夹的 data\\ 目录。

本程序是 64 位 Windows（x86_64）。学生不用装程序。
exe 旁边的 .dll 要一起拷走。
"""
Path(sys.argv[1]).write_bytes(text.replace("\n", "\r\n").encode("utf-8-sig"))
PY

echo "Windows 教室包: $OUT"

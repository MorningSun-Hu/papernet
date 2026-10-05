#!/usr/bin/env bash
# Shared version and timestamps for pack-runtime.sh / pack-windows.sh.

papernet_version() {
  awk -F '"' '/^version = / { print $2; exit }' "${PAPERNET_ROOT}/Cargo.toml"
}

papernet_git_rev() {
  git -C "${PAPERNET_ROOT}" rev-parse --short HEAD 2>/dev/null || echo "unknown"
}

papernet_now() {
  TZ=Asia/Shanghai date "+%Y-%m-%d %H:%M:%S %Z"
}

papernet_pack_info_text() {
  local version="$1"
  local compiled_at="$2"
  local packed_at="$3"
  local platform="$4"
  printf '%s\n' \
    "PaperNet" \
    "版本：${version}" \
    "编译时间：${compiled_at}" \
    "打包时间：${packed_at}" \
    "目标平台：${platform}" \
    "Git 提交：$(papernet_git_rev)"
}

write_papernet_pack_info() {
  papernet_pack_info_text "$2" "$3" "$4" "$5" > "$1"
}

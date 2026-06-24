#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DESKTOP_DIR}/.." && pwd)"

TARGET_TRIPLE="aarch64-apple-darwin"
TAURI_TARGET_DIR="${DESKTOP_DIR}/src-tauri/target"
CANONICAL_OUTPUT_DIR="${DESKTOP_DIR}/build-artifacts/macos-arm64"
APP_BUNDLE_NAME="Gugu Agent.app"
APP_BUNDLE_ID="com.guxingyao.guguagent.desktop"
APP_VERSION="$(grep -m1 '"version"' "${DESKTOP_DIR}/src-tauri/tauri.conf.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
MACOS_CODESIGN_IDENTITY="${GUGU_MACOS_CODESIGN_IDENTITY:-${APPLE_SIGNING_IDENTITY:-${MACOS_CODESIGN_IDENTITY:-}}}"
ALLOW_ADHOC_MACOS_RELEASE="${ALLOW_ADHOC_MACOS_RELEASE:-0}"

usage() {
  cat <<'EOF'
Build Gugu Agent desktop for macOS Apple Silicon and output a DMG.

Usage:
  ./desktop/scripts/build-macos-arm64.sh [extra tauri build args...]

Environment:
  SKIP_INSTALL=1   Skip `bun install` in the repo root and desktop app.
  SIGN_BUILD=1     Remove the default `--no-sign` flag and allow signed builds.
                   Signed builds require TAURI_SIGNING_PRIVATE_KEY or
                   TAURI_SIGNING_PRIVATE_KEY_PATH and emit updater artifacts
                   used by hot update.
  GUGU_MACOS_CODESIGN_IDENTITY / APPLE_SIGNING_IDENTITY / MACOS_CODESIGN_IDENTITY
                   Apple Developer ID Application identity for release builds.
                   Required when SIGN_BUILD=1 unless ALLOW_ADHOC_MACOS_RELEASE=1.
  ALLOW_ADHOC_MACOS_RELEASE=1
                   Emergency/internal only. Allows SIGN_BUILD=1 without a
                   stable Apple Developer ID identity. Users may need to
                   re-grant macOS Accessibility/Screen Recording after update.
  OPEN_OUTPUT=1    Open the canonical artifact output directory in Finder after a successful build.

Examples:
  ./desktop/scripts/build-macos-arm64.sh
  SKIP_INSTALL=1 ./desktop/scripts/build-macos-arm64.sh
  SIGN_BUILD=1 ./desktop/scripts/build-macos-arm64.sh --skip-stapling
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[build-macos-arm64] This script must run on macOS." >&2
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "[build-macos-arm64] This script is intended for Apple Silicon hosts (arm64)." >&2
  exit 1
fi

for command in bun cargo rustc codesign hdiutil; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "[build-macos-arm64] Missing required command: ${command}" >&2
    exit 1
  fi
done

# Prefer rustup shims over Homebrew rustc/cargo when both exist — Cargo deps
# often require a newer toolchain than brew ships by default.
if [[ -d "${HOME}/.cargo/bin" ]]; then
  export PATH="${HOME}/.cargo/bin:${PATH}"
fi

if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  echo "[build-macos-arm64] Installing root dependencies..."
  (cd "${REPO_ROOT}" && bun install)

  echo "[build-macos-arm64] Installing desktop dependencies..."
  (cd "${DESKTOP_DIR}" && bun install)

  if [[ -f "${REPO_ROOT}/adapters/package.json" ]]; then
    echo "[build-macos-arm64] Installing adapter dependencies..."
    (cd "${REPO_ROOT}/adapters" && bun install)
  fi
fi

# ── 清理 + 显式预热前端 / sidecar ────────────────────────────
# 之前遇到过"改了 src/ 代码,build 的 .app 里 sidecar 还是旧的"的诡异
# case —— 根因是 Bun.build / Tauri bundler 某一层的缓存把旧 sidecar
# binary 复用进了新 .app(.app 被删干净了也救不回来,因为 binary 源在
# desktop/src-tauri/binaries/)。
#
# 这里做三件事强制 fresh build:
#   1) 硬删 sidecar 源 binary + Tauri bundle 目录 + 前端 dist
#   2) 显式跑 bun run build + bun run build:sidecars
#   3) tauri build 用 --config 覆盖 beforeBuildCommand 为 true(no-op),
#      避免 sidecar 被重复编译浪费 ~10s
# 任一步失败,整个脚本立即退出(set -e)。
echo "[build-macos-arm64] Cleaning stale sidecar binaries and bundle output..."
rm -rf "${DESKTOP_DIR}/src-tauri/binaries/gugu-sidecar-"*
rm -rf "${DESKTOP_DIR}/src-tauri/binaries/claude-sidecar-"*
rm -rf "${DESKTOP_DIR}/src-tauri/binaries/rtk-"*
rm -rf "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/bundle"
rm -rf "${DESKTOP_DIR}/src-tauri/target/release/bundle"
rm -rf "${DESKTOP_DIR}/dist"
rm -f "${DESKTOP_DIR}/tsconfig.tsbuildinfo"
rm -rf "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/build/gugu-agent-"*
rm -rf "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/.fingerprint/gugu-agent-"*
rm -f "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/deps/gugu_agent-"*
rm -f "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/deps/libgugu_agent-"*
rm -rf "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/build/claude-code-desktop-"*
rm -rf "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/.fingerprint/claude-code-desktop-"*
rm -f "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/deps/claude_code_desktop-"*
rm -f "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/deps/libclaude_code_desktop-"*

echo "[build-macos-arm64] Rebuilding frontend (tsc + vite)..."
(cd "${DESKTOP_DIR}" && bun run build)

echo "[build-macos-arm64] Rebuilding sidecar for ${TARGET_TRIPLE}..."
(
  cd "${DESKTOP_DIR}"
  GUGU_REQUIRE_BUNDLED_RTK=1 TAURI_ENV_TARGET_TRIPLE="${TARGET_TRIPLE}" bun run build:sidecars
)

TAURI_ARGS=(
  bunx
  tauri
  build
  --target
  "${TARGET_TRIPLE}"
  --bundles
  app,dmg
  --ci
  --config
  '{"build":{"beforeBuildCommand":"true"}}'
)

if [[ "${SIGN_BUILD:-0}" != "1" ]]; then
  TAURI_ARGS+=(--no-sign)
else
  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
    if [[ ! -f "${TAURI_SIGNING_PRIVATE_KEY_PATH}" ]]; then
      echo "[build-macos-arm64] TAURI_SIGNING_PRIVATE_KEY_PATH does not exist: ${TAURI_SIGNING_PRIVATE_KEY_PATH}" >&2
      exit 1
    fi
    export TAURI_SIGNING_PRIVATE_KEY="$(cat "${TAURI_SIGNING_PRIVATE_KEY_PATH}")"
  fi

  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
    echo "[build-macos-arm64] SIGN_BUILD=1 requires TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH for updater artifacts." >&2
    exit 1
  fi

  if [[ -z "${MACOS_CODESIGN_IDENTITY}" && "${ALLOW_ADHOC_MACOS_RELEASE}" != "1" ]]; then
    echo "[build-macos-arm64] SIGN_BUILD=1 requires a stable Apple Developer ID signing identity." >&2
    echo "[build-macos-arm64] Set GUGU_MACOS_CODESIGN_IDENTITY, APPLE_SIGNING_IDENTITY, or MACOS_CODESIGN_IDENTITY." >&2
    echo "[build-macos-arm64] Without it, macOS TCC may treat each update as a new app and users may need to re-grant Accessibility/Screen Recording." >&2
    echo "[build-macos-arm64] For emergency/internal unsigned builds only, set ALLOW_ADHOC_MACOS_RELEASE=1." >&2
    exit 1
  fi

  if [[ -z "${MACOS_CODESIGN_IDENTITY}" ]]; then
    echo "[build-macos-arm64] WARN: building SIGN_BUILD=1 with ad-hoc macOS code signing." >&2
    echo "[build-macos-arm64] WARN: Tauri updater signatures will exist, but macOS Accessibility/Screen Recording permissions may not survive updates." >&2
  else
    echo "[build-macos-arm64] Using macOS code signing identity: ${MACOS_CODESIGN_IDENTITY}"
  fi
fi

if [[ "$#" -gt 0 ]]; then
  TAURI_ARGS+=("$@")
fi

echo "[build-macos-arm64] Building DMG for ${TARGET_TRIPLE}..."
(
  cd "${DESKTOP_DIR}"
  export TAURI_ENV_TARGET_TRIPLE="${TARGET_TRIPLE}"
  "${TAURI_ARGS[@]}"
)

TARGETED_DMG_DIR="${TAURI_TARGET_DIR}/${TARGET_TRIPLE}/release/bundle/dmg"
FALLBACK_DMG_DIR="${TAURI_TARGET_DIR}/release/bundle/dmg"
TARGETED_APP_DIR="${TAURI_TARGET_DIR}/${TARGET_TRIPLE}/release/bundle/macos"
FALLBACK_APP_DIR="${TAURI_TARGET_DIR}/release/bundle/macos"
LEGACY_BUNDLE_ROOT="${TAURI_TARGET_DIR}/release/bundle"
TARGETED_UPDATER_DIR="${TAURI_TARGET_DIR}/${TARGET_TRIPLE}/release/bundle/macos"
FALLBACK_UPDATER_DIR="${TAURI_TARGET_DIR}/release/bundle/macos"

mkdir -p "${CANONICAL_OUTPUT_DIR}"
find "${CANONICAL_OUTPUT_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

find_latest_file() {
  local search_dir="$1"
  local pattern="$2"
  if [[ -d "${search_dir}" ]]; then
    find "${search_dir}" -maxdepth 1 -type f -name "${pattern}" | sort | tail -n 1
  fi
}

find_latest_dir() {
  local search_dir="$1"
  local pattern="$2"
  if [[ -d "${search_dir}" ]]; then
    find "${search_dir}" -maxdepth 1 -type d -name "${pattern}" | sort | tail -n 1
  fi
}

LATEST_DMG="$(find_latest_file "${TARGETED_DMG_DIR}" '*.dmg')"
if [[ -z "${LATEST_DMG}" ]]; then
  LATEST_DMG="$(find_latest_file "${FALLBACK_DMG_DIR}" '*.dmg')"
fi

LATEST_APP="$(find_latest_dir "${TARGETED_APP_DIR}" '*.app')"
if [[ -z "${LATEST_APP}" ]]; then
  LATEST_APP="$(find_latest_dir "${FALLBACK_APP_DIR}" '*.app')"
fi

LATEST_UPDATER_ARCHIVE="$(find_latest_file "${TARGETED_UPDATER_DIR}" '*.app.tar.gz')"
if [[ -z "${LATEST_UPDATER_ARCHIVE}" ]]; then
  LATEST_UPDATER_ARCHIVE="$(find_latest_file "${FALLBACK_UPDATER_DIR}" '*.app.tar.gz')"
fi

LATEST_UPDATER_SIGNATURE="$(find_latest_file "${TARGETED_UPDATER_DIR}" '*.app.tar.gz.sig')"
if [[ -z "${LATEST_UPDATER_SIGNATURE}" ]]; then
  LATEST_UPDATER_SIGNATURE="$(find_latest_file "${FALLBACK_UPDATER_DIR}" '*.app.tar.gz.sig')"
fi

LATEST_UPDATER_MANIFEST="$(find_latest_file "${TARGETED_UPDATER_DIR}" 'latest.json')"
if [[ -z "${LATEST_UPDATER_MANIFEST}" ]]; then
  LATEST_UPDATER_MANIFEST="$(find_latest_file "${FALLBACK_UPDATER_DIR}" 'latest.json')"
fi

build_canonical_dmg() {
  local app_bundle="$1"
  local dmg_output="$2"
  local staging_dir
  local rw_dmg

  staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/gugu-agent-dmg.XXXXXX")"
  rw_dmg="$(mktemp "${TMPDIR:-/tmp}/gugu-agent-rw.XXXXXX").dmg"

  cp -R "${app_bundle}" "${staging_dir}/"
  ln -s /Applications "${staging_dir}/Applications"

  # Create a read-write DMG first so we can customize the Finder layout
  hdiutil create \
  -volname "Gugu Agent" \
    -srcfolder "${staging_dir}" \
    -ov \
    -format UDRW \
    "${rw_dmg}" >/dev/null

  rm -rf "${staging_dir}"

  # Mount the read-write DMG and apply Finder layout via AppleScript
  local dev_name mount_dir
  dev_name=$(hdiutil attach -readwrite -noverify -noautoopen -nobrowse "${rw_dmg}" \
    | grep -E '^/dev/' | head -1 | awk '{print $1}')
  mount_dir=$(hdiutil info | grep -E "${dev_name}" | tail -1 | awk '{$1=$2=""; print}' | xargs)

  # Finder AppleScript 在新版 macOS (Sequoia+) 上某些属性
  # (toolbar/statusbar visible、某些 container window 属性) 不再支持,
  # 会返回 -10006 错误。美化失败不是 blocker —— 即便 layout 没设上,
  # DMG 本身还是可用的,只是用户打开时看到的是 Finder 默认排布。
  # 所以这里允许 osascript 非零退出,只 warn,不让 set -e 炸掉整个脚本。
  if ! osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "Gugu Agent"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {100, 100, 760, 500}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    set position of item "${APP_BUNDLE_NAME}" of container window to {180, 170}
    set position of item "Applications" of container window to {480, 170}
    close
    open
    update without registering applications
    delay 2
    close
  end tell
end tell
APPLESCRIPT
  then
    echo "[build-macos-arm64] WARN: Finder layout AppleScript failed (likely macOS version incompatible); DMG will use default Finder layout" >&2
  fi

  sync
  # osascript 可能已经让 Finder 打开了 volume 窗口,正常 detach 可能因为
  # "Resource busy" 失败。失败时用 -force 二次尝试。
  hdiutil detach "${dev_name}" -quiet 2>/dev/null \
    || hdiutil detach "${dev_name}" -force -quiet

  # Convert to compressed read-only DMG
  hdiutil convert "${rw_dmg}" -format UDZO -o "${dmg_output}" -ov >/dev/null
  rm -f "${rw_dmg}"
}

codesign_cdhash() {
  local executable="$1"
  codesign -d --verbose=4 "${executable}" 2>&1 \
    | awk -F= '/^CDHash=/{print $2; exit}'
}

codesign_team_id_from_identity() {
  printf '%s' "${MACOS_CODESIGN_IDENTITY}" \
    | sed -n 's/.*(\([A-Z0-9][A-Z0-9]*\)).*/\1/p' \
    | tail -n 1
}

find_app_macos_binary() {
  local app_bundle="$1"
  local base_name="$2"
  local candidate

  for candidate in \
    "${app_bundle}/Contents/MacOS/${base_name}" \
    "${app_bundle}/Contents/MacOS/${base_name}-${TARGET_TRIPLE}"
  do
    if [[ -f "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  return 1
}

require_app_macos_binary() {
  local app_bundle="$1"
  local base_name="$2"
  local label="$3"
  local path

  if path="$(find_app_macos_binary "${app_bundle}" "${base_name}")"; then
    printf '%s\n' "${path}"
    return 0
  fi

  echo "[build-macos-arm64] ERROR: bundled ${label} is missing: ${app_bundle}/Contents/MacOS/${base_name}{,-${TARGET_TRIPLE}}" >&2
  exit 1
}

verify_expected_codesign_identity() {
  local target="$1"
  local label="$2"
  local details
  local expected_team_id

  if [[ -z "${MACOS_CODESIGN_IDENTITY}" ]]; then
    return
  fi

  details="$(codesign -d --verbose=4 "${target}" 2>&1)"
  expected_team_id="${GUGU_MACOS_TEAM_ID:-${APPLE_TEAM_ID:-$(codesign_team_id_from_identity)}}"

  if ! grep -Fq "Authority=${MACOS_CODESIGN_IDENTITY}" <<<"${details}"; then
    echo "[build-macos-arm64] ERROR: ${label} is not signed by the expected identity: ${MACOS_CODESIGN_IDENTITY}" >&2
    echo "${details}" >&2
    exit 1
  fi

  if [[ -n "${expected_team_id}" ]] && ! grep -Fq "TeamIdentifier=${expected_team_id}" <<<"${details}"; then
    echo "[build-macos-arm64] ERROR: ${label} TeamIdentifier does not match ${expected_team_id}" >&2
    echo "${details}" >&2
    exit 1
  fi
}

verify_app_bundle_identifier() {
  local app_bundle="$1"
  local details
  local expected_identifier

  if [[ -z "${MACOS_CODESIGN_IDENTITY}" ]]; then
    return
  fi

  expected_identifier="${GUGU_MACOS_BUNDLE_IDENTIFIER:-com.guxingyao.guguagent.desktop}"
  details="$(codesign -d --verbose=4 "${app_bundle}" 2>&1)"

  if ! grep -Fq "Identifier=${expected_identifier}" <<<"${details}"; then
    echo "[build-macos-arm64] ERROR: app bundle identifier is not ${expected_identifier}" >&2
    echo "${details}" >&2
    exit 1
  fi
}

codesign_path() {
  local target="$1"
  if [[ -n "${MACOS_CODESIGN_IDENTITY}" ]]; then
    codesign --force --sign "${MACOS_CODESIGN_IDENTITY}" "${target}"
  else
    codesign --force --sign - --timestamp=none "${target}"
  fi
}

sign_canonical_app_bundle() {
  local app_bundle="$1"
  local sidecar=""
  local rtk=""
  local sidecar_cdhash_before=""
  local sidecar_cdhash_after=""

  sidecar="$(find_app_macos_binary "${app_bundle}" "gugu-sidecar" || true)"
  rtk="$(require_app_macos_binary "${app_bundle}" "rtk" "RTK")"

  if [[ -n "${sidecar}" && -x "${sidecar}" ]]; then
    sidecar_cdhash_before="$(codesign_cdhash "${sidecar}")"
  fi

  if [[ ! -x "${rtk}" ]]; then
    echo "[build-macos-arm64] ERROR: bundled RTK is not executable: ${rtk}" >&2
    exit 1
  fi
  codesign_path "${rtk}"
  codesign --verify --verbose=2 "${rtk}"
  verify_expected_codesign_identity "${rtk}" "rtk"

  if [[ -n "${MACOS_CODESIGN_IDENTITY}" && -n "${sidecar}" && -x "${sidecar}" ]]; then
    codesign_path "${sidecar}"
    codesign --verify --verbose=2 "${sidecar}"
    verify_expected_codesign_identity "${sidecar}" "sidecar"
  fi

  # Tauri --no-sign leaves the outer .app with no sealed resources, which
  # fails strict bundle validation once Resources/icon.icns exists. For
  # ad-hoc/internal builds, keep the sidecar hash stable to preserve existing
  # macOS Keychain ACLs. For Developer ID release builds, sign nested binaries
  # explicitly with the same stable identity before sealing the outer bundle.
  codesign_path "${app_bundle}"

  if [[ -z "${MACOS_CODESIGN_IDENTITY}" && -n "${sidecar}" && -x "${sidecar}" ]]; then
    sidecar_cdhash_after="$(codesign_cdhash "${sidecar}")"
    if [[ "${sidecar_cdhash_before}" != "${sidecar_cdhash_after}" ]]; then
      echo "[build-macos-arm64] ERROR: sidecar signature hash changed while signing app bundle" >&2
      echo "[build-macos-arm64] before=${sidecar_cdhash_before}" >&2
      echo "[build-macos-arm64] after=${sidecar_cdhash_after}" >&2
      exit 1
    fi
  fi

  codesign --verify --deep --strict --verbose=2 "${app_bundle}"
  verify_expected_codesign_identity "${app_bundle}" "app bundle"
  verify_app_bundle_identifier "${app_bundle}"
}

create_updater_archive() {
  local app_bundle="$1"
  local archive_output="$2"
  local app_parent
  local app_name

  app_parent="$(dirname "${app_bundle}")"
  app_name="$(basename "${app_bundle}")"

  rm -f "${archive_output}" "${archive_output}.sig"
  COPYFILE_DISABLE=1 LC_ALL=C tar -czf "${archive_output}" -C "${app_parent}" "${app_name}"
}

sign_updater_archive() {
  local archive="$1"

  (
    cd "${DESKTOP_DIR}"
    bunx tauri signer sign "${archive}"
  )

  if [[ ! -s "${archive}.sig" ]]; then
    echo "[build-macos-arm64] ERROR: updater signature was not generated: ${archive}.sig" >&2
    exit 1
  fi
}

verify_updater_archive() {
  local archive="$1"
  local extract_dir
  local extracted_app
  local extracted_rtk
  local extracted_sidecar

  extract_dir="$(mktemp -d "${TMPDIR:-/tmp}/gugu-agent-updater-verify.XXXXXX")"
  COPYFILE_DISABLE=1 LC_ALL=C tar -xzf "${archive}" -C "${extract_dir}"
  extracted_app="${extract_dir}/${APP_BUNDLE_NAME}"

  if [[ ! -d "${extracted_app}" ]]; then
    echo "[build-macos-arm64] ERROR: updater archive does not contain ${APP_BUNDLE_NAME}" >&2
    rm -rf "${extract_dir}"
    exit 1
  fi

  if ! codesign --verify --deep --strict --verbose=2 "${extracted_app}"; then
    rm -rf "${extract_dir}"
    exit 1
  fi

  extracted_rtk="$(require_app_macos_binary "${extracted_app}" "rtk" "updater RTK")"
  extracted_sidecar="$(find_app_macos_binary "${extracted_app}" "gugu-sidecar" || true)"
  if [[ ! -x "${extracted_rtk}" ]]; then
    echo "[build-macos-arm64] ERROR: updater archive RTK is not executable: ${extracted_rtk}" >&2
    rm -rf "${extract_dir}"
    exit 1
  fi

  codesign --verify --verbose=2 "${extracted_rtk}"
  verify_expected_codesign_identity "${extracted_app}" "updater app bundle"
  verify_app_bundle_identifier "${extracted_app}"
  verify_expected_codesign_identity "${extracted_rtk}" "updater rtk"
  if [[ -x "${extracted_sidecar}" ]]; then
    codesign --verify --verbose=2 "${extracted_sidecar}"
    verify_expected_codesign_identity "${extracted_sidecar}" "updater sidecar"
  fi

  rm -rf "${extract_dir}"
}

if [[ -n "${LATEST_DMG}" ]]; then
  cp -f "${LATEST_DMG}" "${CANONICAL_OUTPUT_DIR}/"
fi

if [[ -n "${LATEST_APP}" ]]; then
  # 不要 deep re-sign。曾经脚本在这里跑过
  # `codesign --force --deep --sign - --identifier <bundle-id>` 来统一
  # sidecar 和外层的 signing identifier,但这会改变 sidecar binary 的
  # code signature hash —— macOS Keychain ACL 按 hash 识别 caller,
  # 重签完再访问时会被 ACL 当作"陌生 binary"静默拒绝,导致 CLI 读不到
  # OAuth token,最终请求打到 Anthropic 返回 403 "Request not allowed"。
  # 这里只浅签外层 bundle,让 .app 拥有有效资源封印,同时保留 sidecar hash。
  cp -R "${LATEST_APP}" "${CANONICAL_OUTPUT_DIR}/"
  sign_canonical_app_bundle "${CANONICAL_OUTPUT_DIR}/${APP_BUNDLE_NAME}"
  rm -f "${CANONICAL_OUTPUT_DIR}/"*.dmg
  build_canonical_dmg \
    "${CANONICAL_OUTPUT_DIR}/${APP_BUNDLE_NAME}" \
    "${CANONICAL_OUTPUT_DIR}/Gugu-Agent-${APP_VERSION}-aarch64.dmg"
fi

if [[ "${SIGN_BUILD:-0}" == "1" ]]; then
  CANONICAL_APP_BUNDLE="${CANONICAL_OUTPUT_DIR}/${APP_BUNDLE_NAME}"
  if [[ ! -d "${CANONICAL_APP_BUNDLE}" ]]; then
    echo "[build-macos-arm64] ERROR: canonical app bundle is missing: ${CANONICAL_APP_BUNDLE}" >&2
    exit 1
  fi

  CANONICAL_UPDATER_ARCHIVE="${CANONICAL_OUTPUT_DIR}/Gugu-Agent-${APP_VERSION}-darwin-aarch64.app.tar.gz"
  CANONICAL_UPDATER_SIGNATURE="${CANONICAL_UPDATER_ARCHIVE}.sig"
  UPDATER_BASE_URL="${GUGU_UPDATER_BASE_URL:-https://gxy-download.oss-cn-shanghai.aliyuncs.com}"
  UPDATER_BASE_URL="${UPDATER_BASE_URL%/}"

  # Build the updater archive from the canonical signed app. The Tauri
  # generated macOS updater archive can omit Contents/_CodeSignature even when
  # the DMG app is valid, leaving the updated app with an invalid resource seal.
  create_updater_archive "${CANONICAL_APP_BUNDLE}" "${CANONICAL_UPDATER_ARCHIVE}"
  verify_updater_archive "${CANONICAL_UPDATER_ARCHIVE}"
  sign_updater_archive "${CANONICAL_UPDATER_ARCHIVE}"
  UPDATER_SIGNATURE_VALUE="$(tr -d '\r\n' < "${CANONICAL_UPDATER_SIGNATURE}")"

  cat > "${CANONICAL_OUTPUT_DIR}/latest.json" <<EOF
{
  "version": "${APP_VERSION}",
  "pub_date": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "platforms": {
    "darwin-aarch64-app": {
      "url": "${UPDATER_BASE_URL}/Gugu-Agent-${APP_VERSION}-darwin-aarch64.app.tar.gz",
      "signature": "${UPDATER_SIGNATURE_VALUE}"
    },
    "darwin-aarch64": {
      "url": "${UPDATER_BASE_URL}/Gugu-Agent-${APP_VERSION}-darwin-aarch64.app.tar.gz",
      "signature": "${UPDATER_SIGNATURE_VALUE}"
    }
  }
}
EOF
fi

CANONICAL_RTK_STATUS="missing"
if [[ -d "${CANONICAL_OUTPUT_DIR}/${APP_BUNDLE_NAME}" ]] \
  && find_app_macos_binary "${CANONICAL_OUTPUT_DIR}/${APP_BUNDLE_NAME}" "rtk" >/dev/null; then
  CANONICAL_RTK_STATUS="present"
fi

cat > "${CANONICAL_OUTPUT_DIR}/BUILD_INFO.txt" <<EOF
Target triple: ${TARGET_TRIPLE}
Canonical output: ${CANONICAL_OUTPUT_DIR}
Source DMG: ${LATEST_DMG:-not found}
Source app: ${LATEST_APP:-not found}
Bundled RTK: ${CANONICAL_RTK_STATUS}
Source updater archive: ${LATEST_UPDATER_ARCHIVE:-not found}
Source updater signature: ${LATEST_UPDATER_SIGNATURE:-not found}
Source updater manifest: ${LATEST_UPDATER_MANIFEST:-not found}
Built at: $(date '+%Y-%m-%d %H:%M:%S %z')
EOF

if [[ -d "${LEGACY_BUNDLE_ROOT}" ]]; then
  rm -rf "${LEGACY_BUNDLE_ROOT}"
fi

echo
echo "[build-macos-arm64] Build finished."
if [[ -n "${LATEST_DMG}" ]]; then
  echo "[build-macos-arm64] DMG source: ${LATEST_DMG}"
else
  echo "[build-macos-arm64] No DMG found in ${TARGETED_DMG_DIR} or ${FALLBACK_DMG_DIR}" >&2
fi

if [[ -n "${LATEST_APP}" ]]; then
  echo "[build-macos-arm64] App source: ${LATEST_APP}"
else
  echo "[build-macos-arm64] No .app found in ${TARGETED_APP_DIR} or ${FALLBACK_APP_DIR}" >&2
fi

echo "[build-macos-arm64] Canonical output: ${CANONICAL_OUTPUT_DIR}"
echo "[build-macos-arm64] Removed legacy bundle dir: ${LEGACY_BUNDLE_ROOT}"

if [[ "${OPEN_OUTPUT:-0}" == "1" ]]; then
  open "${CANONICAL_OUTPUT_DIR}"
fi

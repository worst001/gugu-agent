#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESKTOP_DIR="${REPO_ROOT}/desktop"

MODE="run"
VERSION=""
PREVIOUS_VERSION=""
DOMAIN="gxy-download.oss-cn-shanghai.aliyuncs.com"
APP_PATH="/Applications/gugu-agent.app"
ARTIFACT_ROOT="${DESKTOP_DIR}/build-artifacts"
LATEST_JSON="${DESKTOP_DIR}/build-artifacts/latest.json"
STATE_PATH=""
RECEIPT_PATH=""
HEALTH_URL=""
PORT="443"
SKIP_PREVIOUS_CHECK="0"
NO_CLEANUP="0"
OPEN_APP="1"

SERVER_PID=""
HOSTS_BACKUP=""
CERT_SHA1=""
CERT_DIR=""
STAGING_DIR=""
ONLINE_LATEST_VERSION_BEFORE=""

CLEANUP_HOSTS_RESTORED="false"
CLEANUP_STAGING_SERVER_STOPPED="false"
CLEANUP_TEMP_CERT_REMOVED="false"
CLEANUP_ONLINE_LATEST_VERSION=""
RTK_VERSION_OK="false"
RTK_GIT_STATUS_OK="false"
SETUP_COMPLETED="0"

usage() {
  cat <<'EOF'
Run macOS old-version updater smoke for Gugu Agent.

Modes:
  run      Interactive flow: setup staging, wait for upgrade, verify, cleanup.
  setup    Prepare local HTTPS staging and return. Use this before GUI clicking.
  verify   Verify upgraded app, cleanup staging, and write macOS smoke receipt.
  cleanup  Restore hosts, stop staging server, and remove temporary certificate.

Usage:
  ./scripts/desktop-updater-smoke-macos.sh --mode setup --version 0.2.5 --previous-version 0.2.4
  ./scripts/desktop-updater-smoke-macos.sh --mode verify --version 0.2.5 --previous-version 0.2.4
  ./scripts/desktop-updater-smoke-macos.sh --mode run --version 0.2.5 --previous-version 0.2.4

Options:
  --version <x.y.z>              Target version.
  --previous-version <x.y.z>     Installed old public version.
  --mode <run|setup|verify|cleanup>
  --artifact-root <path>         Directory containing latest.json and artifacts. Defaults to desktop/build-artifacts.
  --latest-json <path>           Merged updater manifest. Defaults to desktop/build-artifacts/latest.json.
  --app <path>                   Installed app path. Defaults to /Applications/gugu-agent.app.
  --domain <domain>              Updater domain. Defaults to gxy-download.oss-cn-shanghai.aliyuncs.com.
  --port <port>                  HTTPS staging port. Defaults to 443.
  --state <path>                 State file path. Defaults to desktop/build-artifacts/release-smoke/macos-staging-vX.Y.Z.env.
  --receipt <path>               Receipt output path. Defaults to desktop/build-artifacts/release-smoke/macos-vX.Y.Z.json.
  --health-url <url>             Optional sidecar health URL to curl after relaunch.
  --skip-previous-check          Do not require the installed app to currently be previous-version during setup.
  --no-cleanup                   Verify without cleanup. Not suitable for release receipts.
  --no-open                      Do not relaunch the app during verify.
  -h, --help                     Show this help.

What setup does:
  - copies latest.json plus darwin updater artifacts into a temp staging dir
  - creates and trusts a temporary certificate for the updater domain
  - backs up /etc/hosts and maps the updater domain to 127.0.0.1
  - starts a local HTTPS server on port 443

What verify does:
  - checks /Applications/gugu-agent.app version
  - runs codesign --verify --deep --strict
  - verifies the sidecar binary signature
  - optionally curls --health-url
  - restores hosts, removes temporary certificate, and writes the receipt
EOF
}

log() {
  printf '[macos-updater-smoke] %s\n' "$*"
}

fail() {
  printf '[macos-updater-smoke] ERROR: %s\n' "$*" >&2
  exit 1
}

normalize_version() {
  local value="${1#v}"
  if [[ ! "${value}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    fail "Version must be x.y.z: $1"
  fi
  printf '%s' "${value}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --version)
      VERSION="$(normalize_version "${2:-}")"
      shift 2
      ;;
    --previous-version)
      PREVIOUS_VERSION="$(normalize_version "${2:-}")"
      shift 2
      ;;
    --artifact-root)
      ARTIFACT_ROOT="${2:-}"
      shift 2
      ;;
    --latest-json)
      LATEST_JSON="${2:-}"
      shift 2
      ;;
    --app)
      APP_PATH="${2:-}"
      shift 2
      ;;
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --state)
      STATE_PATH="${2:-}"
      shift 2
      ;;
    --receipt)
      RECEIPT_PATH="${2:-}"
      shift 2
      ;;
    --health-url)
      HEALTH_URL="${2:-}"
      shift 2
      ;;
    --skip-previous-check)
      SKIP_PREVIOUS_CHECK="1"
      shift
      ;;
    --no-cleanup)
      NO_CLEANUP="1"
      shift
      ;;
    --no-open)
      OPEN_APP="0"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

if [[ "${MODE}" != "run" && "${MODE}" != "setup" && "${MODE}" != "verify" && "${MODE}" != "cleanup" ]]; then
  fail "--mode must be run, setup, verify, or cleanup"
fi

if [[ -z "${VERSION}" ]]; then
  fail "--version is required"
fi

if [[ -z "${PREVIOUS_VERSION}" && "${MODE}" != "cleanup" ]]; then
  fail "--previous-version is required"
fi

if [[ -z "${STATE_PATH}" ]]; then
  STATE_PATH="${DESKTOP_DIR}/build-artifacts/release-smoke/macos-staging-v${VERSION}.env"
fi

if [[ -z "${RECEIPT_PATH}" ]]; then
  RECEIPT_PATH="${DESKTOP_DIR}/build-artifacts/release-smoke/macos-v${VERSION}.json"
fi

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || fail "This script must run on macOS"
}

app_version() {
  local plist="${APP_PATH}/Contents/Info.plist"
  [[ -f "${plist}" ]] || return 1
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "${plist}" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "${plist}" 2>/dev/null
}

single_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

write_state_value() {
  printf '%s=%s\n' "$1" "$(single_quote "$2")" >> "${STATE_PATH}"
}

write_state() {
  mkdir -p "$(dirname "${STATE_PATH}")"
  : > "${STATE_PATH}"
  write_state_value VERSION "${VERSION}"
  write_state_value PREVIOUS_VERSION "${PREVIOUS_VERSION}"
  write_state_value DOMAIN "${DOMAIN}"
  write_state_value PORT "${PORT}"
  write_state_value APP_PATH "${APP_PATH}"
  write_state_value ARTIFACT_ROOT "${ARTIFACT_ROOT}"
  write_state_value LATEST_JSON "${LATEST_JSON}"
  write_state_value RECEIPT_PATH "${RECEIPT_PATH}"
  write_state_value HEALTH_URL "${HEALTH_URL}"
  write_state_value SERVER_PID "${SERVER_PID}"
  write_state_value HOSTS_BACKUP "${HOSTS_BACKUP}"
  write_state_value CERT_SHA1 "${CERT_SHA1}"
  write_state_value CERT_DIR "${CERT_DIR}"
  write_state_value STAGING_DIR "${STAGING_DIR}"
  write_state_value ONLINE_LATEST_VERSION_BEFORE "${ONLINE_LATEST_VERSION_BEFORE}"
}

load_state() {
  [[ -f "${STATE_PATH}" ]] || fail "State file not found: ${STATE_PATH}"
  # shellcheck disable=SC1090
  source "${STATE_PATH}"
}

read_online_latest_version() {
  local json
  json="$(curl -fsSL "https://${DOMAIN}/latest.json" 2>/dev/null || true)"
  if [[ -z "${json}" ]]; then
    printf ''
    return
  fi

  JSON_INPUT="${json}" bun -e 'const value = JSON.parse(process.env.JSON_INPUT || "{}").version || ""; process.stdout.write(String(value));' 2>/dev/null || true
}

copy_darwin_artifacts() {
  require_command bun
  [[ -f "${LATEST_JSON}" ]] || fail "Missing latest.json: ${LATEST_JSON}"

  mkdir -p "${STAGING_DIR}"
  cp -f "${LATEST_JSON}" "${STAGING_DIR}/latest.json"

  local names
  names="$(LATEST_JSON="${LATEST_JSON}" VERSION="${VERSION}" bun <<'JS'
const fs = require("fs")
const path = require("path")
const latest = JSON.parse(fs.readFileSync(process.env.LATEST_JSON, "utf8").replace(/^\uFEFF/, ""))
if (latest.version !== process.env.VERSION) {
  throw new Error(`latest.json version is ${latest.version}, expected ${process.env.VERSION}`)
}
const names = new Set()
for (const [platform, entry] of Object.entries(latest.platforms || {})) {
  if (!platform.startsWith("darwin")) continue
  if (!entry.url) throw new Error(`${platform} is missing url`)
  if (!entry.signature || /\s/.test(entry.signature.trim())) {
    throw new Error(`${platform} signature must be a single-line public signature`)
  }
  names.add(path.basename(new URL(entry.url).pathname))
}
if (names.size === 0) throw new Error("latest.json has no darwin updater platform")
for (const name of names) console.log(name)
JS
)"

  while IFS= read -r name; do
    [[ -n "${name}" ]] || continue
    local artifact
    artifact="$(find "${ARTIFACT_ROOT}" -type f -name "${name}" | head -n 1 || true)"
    [[ -n "${artifact}" ]] || fail "Missing darwin updater artifact under ${ARTIFACT_ROOT}: ${name}"
    [[ -f "${artifact}.sig" ]] || fail "Missing darwin updater signature: ${artifact}.sig"
    cp -f "${artifact}" "${STAGING_DIR}/${name}"
    cp -f "${artifact}.sig" "${STAGING_DIR}/${name}.sig"
  done <<< "${names}"
}

create_certificate() {
  require_command openssl

  CERT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gugu-agent-updater-cert.XXXXXX")"
  local config="${CERT_DIR}/cert.cnf"
  local cert="${CERT_DIR}/cert.pem"
  local key="${CERT_DIR}/key.pem"

  cat > "${config}" <<EOF
[req]
prompt = no
distinguished_name = req_distinguished_name
x509_extensions = v3_req

[req_distinguished_name]
CN = ${DOMAIN}

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${DOMAIN}
EOF

  openssl req \
    -x509 \
    -newkey rsa:2048 \
    -nodes \
    -days 3 \
    -sha256 \
    -keyout "${key}" \
    -out "${cert}" \
    -config "${config}" >/dev/null 2>&1

  CERT_SHA1="$(openssl x509 -in "${cert}" -noout -fingerprint -sha1 | sed 's/^.*=//; s/://g')"
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${cert}" >/dev/null
}

install_hosts_intercept() {
  HOSTS_BACKUP="$(mktemp "${TMPDIR:-/tmp}/gugu-hosts.backup.XXXXXX")"
  cp /etc/hosts "${HOSTS_BACKUP}"

  local staged_hosts
  staged_hosts="$(mktemp "${TMPDIR:-/tmp}/gugu-hosts.staged.XXXXXX")"
  cp /etc/hosts "${staged_hosts}"
  {
    printf '\n# gugu-agent-updater-smoke %s\n' "${VERSION}"
    printf '127.0.0.1 %s\n' "${DOMAIN}"
  } >> "${staged_hosts}"

  sudo cp "${staged_hosts}" /etc/hosts
  rm -f "${staged_hosts}"
  flush_dns
}

flush_dns() {
  sudo dscacheutil -flushcache >/dev/null 2>&1 || true
  sudo killall -HUP mDNSResponder >/dev/null 2>&1 || true
}

start_https_server() {
  require_command curl
  local python_bin
  python_bin="$(command -v python3 || true)"
  [[ -n "${python_bin}" ]] || fail "Missing python3; install Python 3 on the Mac test machine"

  if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Port ${PORT} is already in use. Stop that listener before setup."
  fi

  local server_script="${CERT_DIR}/https_server.py"
  cat > "${server_script}" <<'PY'
import functools
import http.server
import ssl
import sys

directory, cert, key, port = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(certfile=cert, keyfile=key)
httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
httpd.serve_forever()
PY

  sudo "${python_bin}" "${server_script}" "${STAGING_DIR}" "${CERT_DIR}/cert.pem" "${CERT_DIR}/key.pem" "${PORT}" > "${CERT_DIR}/https.log" 2>&1 &
  SERVER_PID="$!"

  for _ in $(seq 1 30); do
    if curl -fsS --cacert "${CERT_DIR}/cert.pem" "https://${DOMAIN}/latest.json" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done

  fail "HTTPS staging server did not become ready. Log: ${CERT_DIR}/https.log"
}

setup_staging() {
  require_macos
  require_command sudo
  require_command curl
  require_command lsof
  require_command security

  SETUP_COMPLETED="0"
  trap 'if [[ "${SETUP_COMPLETED}" != "1" ]]; then log "Setup failed; cleaning up partial staging"; stop_server || true; restore_hosts || true; remove_certificate || true; fi' ERR

  if [[ "${SKIP_PREVIOUS_CHECK}" != "1" ]]; then
    local current_version
    current_version="$(app_version || true)"
    [[ "${current_version}" == "${PREVIOUS_VERSION}" ]] \
      || fail "Installed app version is ${current_version:-missing}, expected previous version ${PREVIOUS_VERSION}. Install the old version first or pass --skip-previous-check."
  fi

  ONLINE_LATEST_VERSION_BEFORE="$(read_online_latest_version)"
  STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gugu-agent-updater-staging.XXXXXX")"
  copy_darwin_artifacts
  create_certificate
  install_hosts_intercept
  start_https_server
  write_state
  SETUP_COMPLETED="1"
  trap - ERR

  log "Staging ready."
  log "State: ${STATE_PATH}"
  log "Serve dir: ${STAGING_DIR}"
  log "Now launch the previous app, trigger the in-app update, and wait until it installs ${VERSION}."
}

restore_hosts() {
  if [[ -n "${HOSTS_BACKUP:-}" && -f "${HOSTS_BACKUP}" ]]; then
    sudo cp "${HOSTS_BACKUP}" /etc/hosts
    flush_dns
    if cmp -s "${HOSTS_BACKUP}" /etc/hosts; then
      CLEANUP_HOSTS_RESTORED="true"
    fi
  fi
}

stop_server() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    sudo kill "${SERVER_PID}" >/dev/null 2>&1 || true
    sleep 1
  fi

  if [[ -n "${CERT_DIR:-}" ]]; then
    local server_matches
    server_matches="$(pgrep -f "${CERT_DIR}/https_server.py" 2>/dev/null || true)"
    if [[ -n "${server_matches}" ]]; then
      sudo kill ${server_matches} >/dev/null 2>&1 || true
      sleep 1
    fi
  fi

  if [[ -z "${CERT_DIR:-}" ]] || ! pgrep -f "${CERT_DIR}/https_server.py" >/dev/null 2>&1; then
    CLEANUP_STAGING_SERVER_STOPPED="true"
  fi
}

remove_certificate() {
  if [[ -n "${CERT_SHA1:-}" ]]; then
    sudo security delete-certificate -Z "${CERT_SHA1}" /Library/Keychains/System.keychain >/dev/null 2>&1 || true
    if ! security find-certificate -a -Z -c "${DOMAIN}" /Library/Keychains/System.keychain 2>/dev/null | grep -q "${CERT_SHA1}"; then
      CLEANUP_TEMP_CERT_REMOVED="true"
    fi
  fi
}

cleanup_staging() {
  load_state
  stop_server
  restore_hosts
  remove_certificate
  CLEANUP_ONLINE_LATEST_VERSION="$(read_online_latest_version)"
  log "Cleanup: hostsRestored=${CLEANUP_HOSTS_RESTORED} stagingServerStopped=${CLEANUP_STAGING_SERVER_STOPPED} tempCertRemoved=${CLEANUP_TEMP_CERT_REMOVED} onlineLatest=${CLEANUP_ONLINE_LATEST_VERSION:-unknown}"
}

verify_app() {
  require_macos
  require_command codesign

  [[ -d "${APP_PATH}" ]] || fail "App not found: ${APP_PATH}"

  local installed_version
  installed_version="$(app_version || true)"
  [[ "${installed_version}" == "${VERSION}" ]] || fail "Installed app version is ${installed_version:-missing}, expected ${VERSION}"

  codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

  local sidecar="${APP_PATH}/Contents/MacOS/gugu-sidecar"
  [[ -x "${sidecar}" ]] || fail "Sidecar is missing or not executable: ${sidecar}"
  codesign --verify --verbose=2 "${sidecar}"

  local rtk="${APP_PATH}/Contents/MacOS/rtk"
  if [[ -x "${rtk}" ]]; then
    codesign --verify --verbose=2 "${rtk}"
    if "${rtk}" --version | grep -q '^rtk 0\.39\.0'; then
      RTK_VERSION_OK="true"
    else
      log "WARN: bundled RTK version check failed; macOS bundled RTK is not enforced yet"
    fi
    if (cd "${REPO_ROOT}" && "${rtk}" git status >/dev/null); then
      RTK_GIT_STATUS_OK="true"
    else
      log "WARN: bundled RTK git status check failed; macOS bundled RTK is not enforced yet"
    fi
  else
    log "WARN: RTK is missing or not executable: ${rtk}; macOS bundled RTK is not enforced yet"
  fi

  if [[ "${OPEN_APP}" == "1" ]]; then
    open "${APP_PATH}"
    sleep 8
  fi

  if [[ -n "${HEALTH_URL}" ]]; then
    curl -fsS "${HEALTH_URL}" >/dev/null
  fi
}

write_receipt() {
  local sidecar_ok="true"
  if [[ -n "${HEALTH_URL}" ]]; then
    sidecar_ok="true"
  fi

  mkdir -p "$(dirname "${RECEIPT_PATH}")"
  RECEIPT_PATH="${RECEIPT_PATH}" \
  VERSION="${VERSION}" \
  PREVIOUS_VERSION="${PREVIOUS_VERSION}" \
  APP_PATH="${APP_PATH}" \
  DOMAIN="${DOMAIN}" \
  HEALTH_URL="${HEALTH_URL}" \
  TESTED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  TESTER="$(whoami)" \
  MACHINE="$(sw_vers -productName) $(sw_vers -productVersion) $(sw_vers -buildVersion), $(uname -m)" \
  APP_RELAUNCH_OK="${OPEN_APP}" \
  RTK_VERSION_OK="${RTK_VERSION_OK}" \
  RTK_GIT_STATUS_OK="${RTK_GIT_STATUS_OK}" \
  HOSTS_RESTORED="${CLEANUP_HOSTS_RESTORED}" \
  STAGING_SERVER_STOPPED="${CLEANUP_STAGING_SERVER_STOPPED}" \
  TEMP_CERT_REMOVED="${CLEANUP_TEMP_CERT_REMOVED}" \
  ONLINE_LATEST_VERSION="${CLEANUP_ONLINE_LATEST_VERSION}" \
  SIDECAR_OK="${sidecar_ok}" \
  bun <<'JS'
const fs = require("fs")
const path = require("path")
const receiptPath = process.env.RECEIPT_PATH
const bool = (name) => process.env[name] === "true"
const receipt = {
  platform: "macos",
  version: process.env.VERSION,
  previousVersion: process.env.PREVIOUS_VERSION,
  status: "passed",
  upgrade: {
    passed: true,
    from: process.env.PREVIOUS_VERSION,
    to: process.env.VERSION,
  },
  checks: {
    appVersionOk: true,
    rtkVersionOk: bool("RTK_VERSION_OK"),
    rtkGitStatusOk: bool("RTK_GIT_STATUS_OK"),
    sidecarOk: bool("SIDECAR_OK"),
    codesignStrict: true,
    appRelaunchOk: bool("APP_RELAUNCH_OK"),
  },
  cleanup: {
    hostsRestored: bool("HOSTS_RESTORED"),
    stagingServerStopped: bool("STAGING_SERVER_STOPPED"),
    tempCertRemoved: bool("TEMP_CERT_REMOVED"),
    onlineLatestVersion: process.env.ONLINE_LATEST_VERSION || "",
  },
  evidence: {
    tester: process.env.TESTER,
    testedAt: process.env.TESTED_AT,
    machine: process.env.MACHINE,
    appPath: process.env.APP_PATH,
    updaterDomain: process.env.DOMAIN,
    healthUrl: process.env.HEALTH_URL || "",
  },
}
fs.mkdirSync(path.dirname(receiptPath), { recursive: true })
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
JS

  log "Receipt written: ${RECEIPT_PATH}"
}

verify_and_cleanup() {
  load_state
  verify_app

  if [[ "${NO_CLEANUP}" == "1" ]]; then
    CLEANUP_HOSTS_RESTORED="false"
    CLEANUP_STAGING_SERVER_STOPPED="false"
    CLEANUP_TEMP_CERT_REMOVED="false"
    CLEANUP_ONLINE_LATEST_VERSION=""
  else
    cleanup_staging
  fi

  write_receipt
}

if [[ "${MODE}" == "setup" ]]; then
  setup_staging
  exit 0
fi

if [[ "${MODE}" == "cleanup" ]]; then
  cleanup_staging
  exit 0
fi

if [[ "${MODE}" == "verify" ]]; then
  verify_and_cleanup
  exit 0
fi

if [[ "${MODE}" == "run" ]]; then
  setup_staging
  trap 'log "Interrupted; cleaning up staging"; cleanup_staging || true' INT TERM EXIT
  printf '\nTrigger the app updater now. Press Enter after the upgraded app is installed and relaunched.\n'
  read -r _
  trap - INT TERM EXIT
  verify_and_cleanup
fi

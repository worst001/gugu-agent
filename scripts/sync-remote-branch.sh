#!/usr/bin/env bash
set -euo pipefail

# Reset a local branch to the remote version, treating the remote as source of truth.
#
# Usage:
#   scripts/sync-remote-branch.sh
#   scripts/sync-remote-branch.sh --discard-changes
#
# Optional environment overrides:
#   BRANCH=main
#   REMOTE=origin
#   REMOTE_BRANCH=main

DISCARD_CHANGES=0

usage() {
  printf '%s\n' \
    "Reset a local branch to the remote version, treating the remote as source of truth." \
    "" \
    "Usage:" \
    "  scripts/sync-remote-branch.sh" \
    "  scripts/sync-remote-branch.sh --discard-changes" \
    "" \
    "Optional environment overrides:" \
    "  BRANCH=main" \
    "  REMOTE=origin" \
    "  REMOTE_BRANCH=main"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --discard-changes)
      DISCARD_CHANGES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: this script must be run inside a git repository" >&2
  exit 1
fi

current_branch="$(git branch --show-current)"
if [[ -z "${current_branch}" ]]; then
  echo "error: detached HEAD; checkout a local branch first" >&2
  exit 1
fi

BRANCH="${BRANCH:-${current_branch}}"
if [[ "${BRANCH}" != "${current_branch}" ]]; then
  echo "error: expected to be on ${BRANCH}, currently on ${current_branch}" >&2
  exit 1
fi

upstream_ref="$(git rev-parse --abbrev-ref --symbolic-full-name "${BRANCH}@{upstream}" 2>/dev/null || true)"
if [[ -n "${upstream_ref}" ]]; then
  default_remote="${upstream_ref%%/*}"
  default_remote_branch="${upstream_ref#*/}"
else
  default_remote="origin"
  default_remote_branch="${BRANCH}"
fi

REMOTE="${REMOTE:-${default_remote}}"
REMOTE_BRANCH="${REMOTE_BRANCH:-${default_remote_branch}}"
remote_ref="${REMOTE}/${REMOTE_BRANCH}"

if ! git remote get-url "${REMOTE}" >/dev/null 2>&1; then
  echo "error: remote '${REMOTE}' does not exist" >&2
  exit 1
fi

status="$(git status --porcelain)"
if [[ -n "${status}" && "${DISCARD_CHANGES}" != "1" ]]; then
  echo "error: working tree is not clean; commit or stash changes first" >&2
  echo
  git status --short
  echo
  echo "If you really want to discard local changes, rerun with --discard-changes." >&2
  exit 1
fi

echo "Fetching ${REMOTE}/${REMOTE_BRANCH}..."
git fetch "${REMOTE}" "+refs/heads/${REMOTE_BRANCH}:refs/remotes/${REMOTE}/${REMOTE_BRANCH}"

if ! git show-ref --verify --quiet "refs/remotes/${remote_ref}"; then
  echo "error: remote branch '${remote_ref}' was not found" >&2
  exit 1
fi

if [[ "${DISCARD_CHANGES}" == "1" ]]; then
  echo "Discarding local tracked and untracked changes..."
  git clean -fd
fi

echo "Resetting ${BRANCH} to ${remote_ref}..."
git reset --hard "${remote_ref}"

echo
echo "Synced ${BRANCH} to ${remote_ref}:"
git log -1 --oneline

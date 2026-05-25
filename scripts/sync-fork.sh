#!/usr/bin/env bash
set -euo pipefail

# Sync the local branch with the upstream repository and push it to a fork.
#
# Usage:
#   scripts/sync-fork.sh
#
# Optional environment overrides:
#   BRANCH=main
#   UPSTREAM_REMOTE=origin
#   FORK_URL=git@github.com:worst001/cc-haha.git

BRANCH="${BRANCH:-main}"
UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-origin}"
FORK_URL="${FORK_URL:-git@github.com:worst001/cc-haha.git}"

current_branch="$(git branch --show-current)"
if [[ "${current_branch}" != "${BRANCH}" ]]; then
  echo "error: expected to be on ${BRANCH}, currently on ${current_branch}" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean; commit or stash changes first" >&2
  git status --short
  exit 1
fi

echo "Fetching ${UPSTREAM_REMOTE}/${BRANCH}..."
git fetch "${UPSTREAM_REMOTE}" "${BRANCH}"

echo "Merging ${UPSTREAM_REMOTE}/${BRANCH} into ${BRANCH}..."
git merge --no-edit "${UPSTREAM_REMOTE}/${BRANCH}"

echo "Pushing ${BRANCH} to ${FORK_URL}..."
git push "${FORK_URL}" "HEAD:${BRANCH}"

echo "Done."

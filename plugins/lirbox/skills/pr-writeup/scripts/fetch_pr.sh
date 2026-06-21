#!/usr/bin/env bash
# Gather everything needed to write a PR write-up into one directory.
#
# Usage:
#   fetch_pr.sh <pr-number> [--repo owner/name] [--out <dir>]
#
# Works on GitHub PRs via the `gh` CLI. For local-branch write-ups (no PR yet),
# see the "Local branch mode" section in SKILL.md and skip this script.
#
# Outputs into <dir> (default ./.pr-writeup/<pr-number>/):
#   meta.json     - title, number, body, author, branches, +/- counts, state, url, labels
#   files.json    - per-file path, additions, deletions, status
#   commits.json  - commit messages (subject + body)
#   diff.patch    - full unified diff, with hidden-folder sections (.planning/, .claude/, etc.) stripped
#   stat.txt      - human-readable diffstat
set -euo pipefail

PR="${1:?usage: fetch_pr.sh <pr-number> [--repo owner/name] [--out dir]}"
shift || true
REPO=""
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --out)  OUT="$2";  shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

REPO_ARG=()
[ -n "$REPO" ] && REPO_ARG=(--repo "$REPO")
OUT="${OUT:-./.pr-writeup/$PR}"
mkdir -p "$OUT"

echo "Fetching PR #$PR ${REPO:+($REPO)} -> $OUT" >&2

gh pr view "$PR" "${REPO_ARG[@]}" \
  --json number,title,body,author,baseRefName,headRefName,additions,deletions,changedFiles,state,url,labels,createdAt,mergedAt \
  > "$OUT/meta.json"

gh pr view "$PR" "${REPO_ARG[@]}" --json files \
  --jq '.files' > "$OUT/files.json"

gh pr view "$PR" "${REPO_ARG[@]}" --json commits \
  --jq '[.commits[] | {oid: .oid[0:9], subject: .messageHeadline, body: .messageBody}]' \
  > "$OUT/commits.json"

# Full diff, excluding any file under a hidden directory (.planning/, .claude/, etc.)
# Mirrors the CLAUDE.md PR-review filter so write-ups focus on source changes.
gh pr diff "$PR" "${REPO_ARG[@]}" \
  | awk '/^diff --git/{skip=0; if(/[ab]\/\./){skip=1}} !skip' \
  > "$OUT/diff.patch"

# Compact diffstat for the file-by-file section.
{ echo "files changed:"; jq -r '.[] | "  \(.changeType[0:3]|ascii_downcase)  +\(.additions)/-\(.deletions)  \(.path)"' "$OUT/files.json"; } \
  > "$OUT/stat.txt" 2>/dev/null || true

echo "Done. Wrote:" >&2
ls -la "$OUT" >&2
echo "$OUT"

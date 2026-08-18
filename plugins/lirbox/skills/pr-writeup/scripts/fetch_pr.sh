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

# The PR number and repo are usually read out of something — a ticket, a chat
# message, a link in a README — and land here unexamined. Two things go wrong if
# they are not checked: PR becomes part of the output path below (`../..` writes
# somewhere else), and both are passed to `gh`, which reads a leading `-` as one
# of ITS flags no matter how well the shell quoted it. A PR number is a number
# and a repo is owner/name; anything else is a mistake worth stopping on.
case "$PR" in
  ''|*[!0-9]*) echo "fetch_pr.sh: <pr-number> must be digits, got: $PR" >&2; exit 2 ;;
esac
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --out)  OUT="$2";  shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [ -n "$REPO" ] && ! printf '%s' "$REPO" | grep -qE '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'; then
  echo "fetch_pr.sh: --repo must be owner/name, got: $REPO" >&2; exit 2
fi

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
#
# The old test was `/[ab]\/\./` against the whole line, which only matched a
# hidden directory at the TOP level: `a/.claude/x` was stripped but `a/src/.env`
# sailed through into the write-up, secrets and all. Strip the `a/`/`b/` prefix
# off each path and look for a dot-leading component anywhere in what is left.
# (Paths with spaces are git-quoted and fall outside the field split; those are
# left in the diff rather than silently half-matched.)
gh pr diff "$PR" "${REPO_ARG[@]}" \
  | awk '
      /^diff --git/ {
        skip = 0
        for (i = 3; i <= 4; i++) { p = $i; sub(/^[ab]\//, "", p); if (p ~ /(^|\/)\./) skip = 1 }
      }
      !skip' \
  > "$OUT/diff.patch"

# Compact diffstat for the file-by-file section.
{ echo "files changed:"; jq -r '.[] | "  \(.changeType[0:3]|ascii_downcase)  +\(.additions)/-\(.deletions)  \(.path)"' "$OUT/files.json"; } \
  > "$OUT/stat.txt" 2>/dev/null || true

echo "Done. Wrote:" >&2
ls -la "$OUT" >&2
echo "$OUT"

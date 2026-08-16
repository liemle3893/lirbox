#!/bin/zsh
# Stop — refuse to end a turn while OUR lanes are live and nothing is watching.
#
# Two failures this exists to stop, both from the 2026-08 run:
#   * turn ended "Three verifiers running. Holding REPLAYCOST" with no Monitor
#     armed; the run sat idle until a human poked it.
#   * lanes finished, panes left open; 15 dead panes accumulated.
#
# Only lanes in the ledger are considered — panes a human is working in are
# invisible to this hook by construction. See lane-ledger.sh.
#
# Escapes, in order: not our agent / already blocked once this turn / a
# background task (Monitor) is armed, which is a legitimate way to end a turn.

emulate -L zsh
setopt no_nomatch

IN=$(cat)
[[ "$(print -r -- "$IN" | jq -r '.agent_type // ""')" == "lirbox:lirbox-herdr-orchestrator" ]] || exit 0
[[ "$(print -r -- "$IN" | jq -r '.stop_hook_active // false')" == "true" ]] && exit 0
[[ "$(print -r -- "$IN" | jq -r '.background_tasks | length')" -gt 0 ]] && exit 0

CWD=$(print -r -- "$IN" | jq -r '.cwd // ""')
# --path-format=absolute is load-bearing: without it git answers `.git` from a
# repo root, `../../.git` from a subdir, and an absolute path from a worktree.
# Every repo root would share one ledger, and one repo would split across three.
KEY=$(git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[[ -n "$KEY" ]] || KEY="$CWD"
LEDGER="$HOME/.claude/lirbox-lanes/$(print -rn -- "$KEY" | shasum | cut -c1-12).tsv"
[[ -s "$LEDGER" ]] || exit 0

LIST=$(HERDR_ENV=1 herdr agent list 2>/dev/null) || exit 0
[[ -n "$LIST" ]] || exit 0

# Intersect the live pane table with the ledger. jq does the join so a lane name
# that is a substring of another cannot match by accident.
OWNED=$(print -r -- "$LIST" | jq -r --rawfile led "$LEDGER" '
  ($led | split("\n") | map(select(length>0))) as $mine
  | .result.agents
  | map(select(.name != null and (.name | IN($mine[]))))
  | .[] | "  \(.name)  \(.pane_id)  \(.agent_status)"' 2>/dev/null)

[[ -n "$OWNED" ]] || exit 0

LIVE=$(print -r -- "$OWNED" | grep -E '(working|blocked)$')
if [[ -n "$LIVE" ]]; then
  print -u2 -r -- "GATE: your lanes are still running and no Monitor is armed.

$LIVE

Arm a Monitor (or herdr agent wait) and keep the turn open. Answering a question
is not a reason to stop dispatching — that is what left the last run idle."
  exit 2
fi

# Nothing live: every owned lane is terminal but its pane is still open.
print -u2 -r -- "GATE: no lane is running and these panes you started are still open.

$OWNED

Close the ones whose work is durable: herdr pane close <pane_id> (leaves the
worktree intact). Close nothing you did not start — this list is only yours.
Then say what remains of the goal, or dispatch it."
exit 2

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

# A STOPPED lane reads exactly like a working one here. `T` is alive, holding all
# its memory, and never scheduled; it is freed by SIGCONT and nothing else. The
# LIVE branch below would answer it with "arm a Monitor and keep the turn open" —
# waiting on a process the kernel will never run again. No value of agent_status
# can distinguish it, because process state is not in that table. Read it.
#
# Cheap by construction: T is rare, so on almost every Stop this ends at the awk.
STOPPED_PIDS=$(ps -A -o pid=,stat= 2>/dev/null | awk '$2 ~ /^T/ {print $1}')
if [[ -n "$STOPPED_PIDS" ]]; then
  typeset -a STOPPED_AT
  local p c
  for p in ${(f)STOPPED_PIDS}; do
    # ps carries no cwd on macOS; lsof is the only mapping from a pid to the
    # checkout it is sitting in, and the checkout is what identifies the lane.
    c=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
    [[ -n "$c" ]] && STOPPED_AT+=("$p"$'\t'"$c")
  done

  if (( $#STOPPED_AT )); then
    PANES=$(HERDR_ENV=1 herdr pane list 2>/dev/null)
    typeset -a FROZEN
    local line name pane pcwd entry epid ecwd
    for line in ${(f)OWNED}; do
      name=${${(z)line}[1]}; pane=${${(z)line}[2]}
      pcwd=$(print -r -- "$PANES" | jq -r --arg p "$pane" \
        '.result.panes[]? | select(.pane_id == $p) | .cwd' 2>/dev/null | head -1)
      [[ -n "$pcwd" ]] || continue
      for entry in $STOPPED_AT; do
        epid=${entry%%$'\t'*}; ecwd=${entry#*$'\t'}
        # Prefix, not equality: a lane's own subprocess sits in a subdirectory of
        # the checkout, and stopping it stops the lane just the same.
        [[ "$ecwd" == "$pcwd" || "$ecwd" == "$pcwd"/* ]] \
          && FROZEN+=("  $name  $pane  pid $epid  STOPPED (T)  $ecwd")
      done
    done

    if (( $#FROZEN )); then
      print -u2 -r -- "GATE: these lanes are STOPPED, not working.

${(F)FROZEN}

A T process is alive and holding all its memory, but the kernel will not schedule
it. It resumes on SIGCONT alone — ctrl+c cannot be delivered until it does, so
sending one frees nothing and waiting on a Monitor waits forever.

  kill -CONT <pid>

Then confirm tokens and cost start advancing again before you treat the lane as
working. Do not close the pane and do not redispatch: the checkout and the work
are intact, and this is recoverable."
      exit 2
    fi
  fi
fi

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

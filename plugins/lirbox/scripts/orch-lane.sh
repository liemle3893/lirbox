#!/bin/zsh
# One command per lane operation. Not a recipe for the orchestrator to follow —
# a thing it runs.
#
#   orch-lane.sh start <name> --profile <p> --branch <b> [--base <b>] [--run <slug>]
#   orch-lane.sh brief <name> <file>
#   orch-lane.sh close <name>
#
# Every step the agent used to perform by hand is here because each one was a
# place the 2026-08 run went wrong: kind and model re-decided per spawn, a lane
# started with no bounded-context profile, a prompt pasted but never submitted,
# a pane closed that belonged to a human, a dispatch record written late or not
# at all. A stub the agent assembles is a stub the agent can assemble wrongly.

emulate -L zsh
setopt no_nomatch pipefail

die() { print -u2 -r -- "orch-lane: $1"; exit 1 }
h()   { HERDR_ENV=1 herdr "$@" }

SUB="${1:-}"; shift 2>/dev/null || true
[[ -n "$SUB" ]] || die "usage: orch-lane.sh [start|brief|close] ..."

# Same key as the ledger and the config — see hooks/lane-ledger.sh.
KEY=$(git -C "$PWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[[ -n "$KEY" ]] || KEY="$PWD"
SLUG=$(print -rn -- "$KEY" | shasum | cut -c1-12)
CFG="$HOME/.claude/lirbox-orchestrator/$SLUG.json"
LEDGER="$HOME/.claude/lirbox-lanes/$SLUG.tsv"

own() {
  mkdir -p "${LEDGER:h}"
  local t
  for t in "$@"; do
    [[ -n "$t" ]] || continue
    grep -qxF "$t" "$LEDGER" 2>/dev/null || print -r -- "$t" >> "$LEDGER"
  done
}
owned() { grep -qxF "$1" "$LEDGER" 2>/dev/null }

case "$SUB" in

start)
  NAME="${1:-}"; shift 2>/dev/null || true
  [[ -n "$NAME" ]] || die "start needs a lane name"
  local PROFILE="" BRANCH="" BASE="dev" RUN="" DRY=0
  while (( $# )); do
    case "$1" in
      --profile) PROFILE="$2"; shift 2 ;;
      --branch)  BRANCH="$2";  shift 2 ;;
      --base)    BASE="$2";    shift 2 ;;
      --run)     RUN="$2";     shift 2 ;;
      --dry-run) DRY=1;        shift   ;;
      *) die "unknown flag: $1" ;;
    esac
  done
  [[ -r "$CFG" ]] || die "no config for this repo.
  Run: ${0:h}/../skills/lane-config/scripts/orch-config.sh init
  Then fill it with the user before starting any lane."
  [[ -n "$PROFILE" ]] || die "start needs --profile. A lane without a bounded-context profile has no
invariants and no ubiquitous language, and will invent both.
  declared: $(jq -r '.profiles | keys | join(", ")' "$CFG")"
  [[ -n "$BRANCH" ]] || BRANCH="$NAME"

  local KIND MODEL FLAGS TIMEOUT EFFORT
  KIND=$(jq -r --arg p "$PROFILE" '.profiles[$p].kind // empty' "$CFG")
  [[ -n "$KIND" ]] || die "profile '$PROFILE' is not declared for this project.
  declared: $(jq -r '.profiles | keys | join(", ")' "$CFG")
  Add it to $CFG deliberately; do not pick a harness to suit the lane."
  MODEL=$(jq -r --arg p "$PROFILE" '.profiles[$p].model // empty' "$CFG")
  FLAGS=$(jq -r --arg p "$PROFILE" '.profiles[$p].flags // [] | join(" ")' "$CFG")
  EFFORT=$(jq -r --arg p "$PROFILE" '.profiles[$p].effort // empty' "$CFG")
  # Effort is a claude flag only. opencode's interactive entry (what herdr
  # starts) has no equivalent — --variant is `opencode run` only, and the tui
  # ignores unknown flags without error, so emitting one would do nothing and
  # look like it worked. set-profile refuses to store this combination; refuse
  # it here too rather than trust the config to be clean.
  local EFLAG=""
  if [[ -n "$EFFORT" ]]; then
    [[ "$KIND" == claude ]] || die "profile '$PROFILE' declares effort '$EFFORT' on an opencode lane,
  which has no effort flag. Fix the profile with orch-config.sh set-profile."
    EFLAG="--effort"
  fi
  TIMEOUT=$(jq -r '.lanes.timeout_ms // 120000' "$CFG")

  # Refuse to exceed the declared lane cap rather than discovering it as load.
  local CAP LIVE
  CAP=$(jq -r '.lanes.max_concurrent // empty' "$CFG")
  if [[ -n "$CAP" ]]; then
    LIVE=$(h agent list 2>/dev/null | jq -r --rawfile led "$LEDGER" '
      ($led | split("\n") | map(select(length>0))) as $mine
      | [.result.agents[] | select(.name != null and (.name | IN($mine[])))
         | select(.agent_status=="working" or .agent_status=="blocked")] | length' 2>/dev/null)
    [[ -n "$LIVE" ]] || LIVE=0
    (( LIVE < CAP )) || die "lane cap reached: $LIVE live, cap $CAP (lanes.max_concurrent).
  Wait for one to land, or raise the cap in $CFG deliberately."
  fi

  if (( DRY )); then
    local -a DA
    DA=(agent start "$NAME" --kind "$KIND" --pane '<pane>' --timeout "$TIMEOUT" -- --agent "$PROFILE")
    [[ -n "$MODEL" ]] && DA+=(--model "$MODEL")
    [[ -n "$EFLAG" ]] && DA+=($EFLAG "$EFFORT")
    [[ -n "$FLAGS" ]] && DA+=(${=FLAGS})
    print -r -- "herdr worktree create --branch $BRANCH --base $BASE --label $NAME --no-focus --json"
    print -r -- "herdr $DA"
    exit 0
  fi

  local WT PANE WS
  WT=$(h worktree create --branch "$BRANCH" --base "$BASE" --label "$NAME" --no-focus --json) \
    || die "worktree create failed for $BRANCH"
  PANE=$(print -r -- "$WT" | jq -r '.result.root_pane.pane_id // empty')
  WS=$(print -r -- "$WT"   | jq -r '.result.workspace.workspace_id // empty')
  [[ -n "$PANE" ]] || die "worktree create returned no pane_id: $WT"
  own "$NAME" "$PANE" "$WS"

  local -a ARGS
  ARGS=(agent start "$NAME" --kind "$KIND" --pane "$PANE" --timeout "$TIMEOUT" -- --agent "$PROFILE")
  [[ -n "$MODEL" ]] && ARGS+=(--model "$MODEL")
  [[ -n "$EFLAG" ]] && ARGS+=($EFLAG "$EFFORT")
  [[ -n "$FLAGS" ]] && ARGS+=(${=FLAGS})
  h $ARGS >/dev/null || die "agent start failed for $NAME on $PANE"

  if [[ -n "$RUN" ]]; then
    local D=".orchestration/$RUN/dispatch"
    mkdir -p "$D"
    jq -n --arg n "$NAME" --arg p "$PANE" --arg w "$WS" --arg pr "$PROFILE" \
          --arg k "$KIND" --arg m "$MODEL" --arg e "$EFFORT" --arg b "$BRANCH" \
          --arg sha "$(git rev-parse HEAD 2>/dev/null)" \
      '{agent_name:$n,pane_id:$p,workspace_id:$w,profile:$pr,kind:$k,model:$m,effort:$e,branch:$b,sha_at_dispatch:$sha,state:"dispatched"}' \
      > "$D/$NAME.json"
  fi

  jq -n --arg n "$NAME" --arg p "$PANE" --arg w "$WS" --arg pr "$PROFILE" --arg k "$KIND" \
        --arg m "$MODEL" --arg b "$BRANCH" --arg path "$(print -r -- "$WT" | jq -r '.result.worktree.path // empty')" \
    '{lane:$n,pane:$p,workspace:$w,profile:$pr,kind:$k,model:$m,branch:$b,worktree:$path}'

  print -u2 -r -- "Setup for this lane's first instruction (setup.* from config):
$(jq -r '.setup | to_entries[] | select(.key|startswith("_")|not) | "  \(.key): \(.value)"' "$CFG")"
  ;;

brief)
  NAME="${1:-}"; FILE="${2:-}"
  [[ -n "$NAME" && -n "$FILE" ]] || die "usage: orch-lane.sh brief <name> <file>"
  [[ -r "$FILE" ]] || die "no such brief file: $FILE"
  owned "$NAME" || die "lane '$NAME' is not one this run created. Refusing to write into it."

  h agent prompt "$NAME" "$(cat -- "$FILE")" >/dev/null || die "prompt failed for $NAME"
  # `agent prompt` pastes without submitting; the pane sits at `[Pasted text #N]`.
  h agent send-keys "$NAME" enter >/dev/null 2>&1 || true
  sleep 1
  local ST
  ST=$(h agent get "$NAME" 2>/dev/null | jq -r '.result.agent.agent_status // .result.agent_status // "unknown"')
  if [[ "$ST" == idle ]]; then
    # Enter did not take. The pane's own send-keys is the documented fallback.
    local PANE
    PANE=$(h agent list | jq -r --arg n "$NAME" '.result.agents[] | select(.name==$n) | .pane_id')
    [[ -n "$PANE" ]] && h pane send-keys "$PANE" enter >/dev/null 2>&1
    sleep 1
    ST=$(h agent get "$NAME" 2>/dev/null | jq -r '.result.agent.agent_status // .result.agent_status // "unknown"')
  fi
  print -r -- "$NAME: $ST"
  [[ "$ST" == idle ]] && die "brief did not submit — '$NAME' is still idle. Check the pane by hand."
  ;;

close)
  NAME="${1:-}"; shift 2>/dev/null || true
  local FORCE=0
  [[ "${1:-}" == "--force" ]] && FORCE=1
  [[ -n "$NAME" ]] || die "close needs a lane name"
  owned "$NAME" || die "lane '$NAME' is not one this run created. Refusing to close it."

  local ROW PANE ST
  ROW=$(h agent list | jq -c --arg n "$NAME" '.result.agents[] | select(.name==$n)')
  [[ -n "$ROW" ]] || die "no live pane for '$NAME' — already closed?"
  PANE=$(print -r -- "$ROW" | jq -r '.pane_id')
  ST=$(print -r -- "$ROW"   | jq -r '.agent_status')

  # Closing a pane kills the agent in it. Doing that to a lane still mid-task
  # destroys whatever only that pane holds — the md's rule is that a pane is
  # cleared once its work is durable, never before.
  if [[ "$ST" == (working|blocked) ]] && (( ! FORCE )); then
    die "lane '$NAME' is $ST, not finished. Closing now kills the agent mid-task.
  Wait for it to land, or pass --force if you have confirmed its work is durable."
  fi

  # Even when idle/done: uncommitted work in its checkout is work only that pane
  # knew about. Say so rather than discovering it later.
  local WT DIRTY
  WT=$(print -r -- "$ROW" | jq -r '.cwd // empty')
  if [[ -n "$WT" && -d "$WT" ]]; then
    DIRTY=$(git -C "$WT" status --short 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$DIRTY" != 0 ]] && (( ! FORCE )); then
      die "lane '$NAME' is $ST but its checkout has $DIRTY uncommitted change(s):
  $WT
  Get them committed, or pass --force to close anyway."
    fi
  fi

  h pane close "$PANE" >/dev/null || die "pane close failed for $PANE"
  print -r -- "closed $NAME ($PANE, was $ST); worktree left intact"
  ;;

*) die "unknown subcommand: $SUB" ;;
esac

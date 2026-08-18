#!/bin/zsh
# PreToolUse(Bash) — work does not leave this machine ungated.
#
# conductor's CodeGate is unskippable because its conductor is pure JS with no
# `fs`: the program decides, the model never does, and a failed gate `throw`s.
# lanes has no program — the orchestrator IS the agent, holding Bash — so that
# shape is unavailable and SKILL.md says so: "loom's gates are structural. Ours
# are procedural."
#
# A PreToolUse hook is the exception. It is the one thing in lanes the
# orchestrator cannot talk its way past, which is why the spawn door lives in
# one. So the gate binds here, on the OUTWARD verbs, and not on transition.mjs:
# a clause in the door enforces nothing when nobody opens the door, and in the
# 2026-08 run transitions.jsonl stopped two days before the session ended.
#
# Scope, and its limit. PreToolUse only sees the ORCHESTRATOR's tool calls.
# Lane workers are separate opencode/claude processes in their own panes and no
# plugin hook ever fires for them, so this cannot gate what a lane does inside
# its worktree. It gates what leaves: push, PR, and a merge into the base
# branch. That is also where lanes already says the human decides.
#
# Which lane: by BRANCH. Every dispatch record carries the branch its lane was
# cut for, so the branch being pushed/merged names the lane, and the lane names
# the gate artifact that has to exist.
#
# Parsing is pure zsh. `grep` here is a shell function in some contexts and
# ugrep in others, and an interpolated ERE through a pipeline returns EMPTY
# rather than erroring — which in a deny-by-default gate means allow.

emulate -L zsh
setopt no_nomatch

IN=$(cat)
[[ "$(print -r -- "$IN" | jq -r '.agent_type // ""')" == "lirbox:lirbox-herdr-orchestrator" ]] || exit 0

CMD=$(print -r -- "$IN" | jq -r '.tool_input.command // ""')
# Deny is a demand to say it out loud, not a veto on judgement — same escape as
# the spawn door and the model policy.
[[ "$CMD" == *POLICY-OVERRIDE* ]] && exit 0

CWD=$(print -r -- "$IN" | jq -r '.cwd // ""')
ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
[[ -n "$ROOT" ]] || exit 0

# In a repo that has never run a lane there is nothing to gate, and this hook
# must be invisible. Engage only where a run store actually exists.
typeset -a RECORDS
RECORDS=("$ROOT"/.orchestration/*/dispatch/*.json(N))
(( $#RECORDS )) || exit 0

typeset -a TOK
TOK=(${(z)CMD})

# ---------------------------------------------------------------------------
# Which outward verb, and which branch it moves.
#
#   git push [remote] [branch]        -> that branch, else HEAD
#   git merge <ref>                   -> <ref>, only when merging INTO a base
#   gh pr create ...                  -> HEAD
# ---------------------------------------------------------------------------
local VERB="" TARGET=""
integer i
for (( i = 1; i <= $#TOK; i++ )); do
  case "${TOK[i]} ${TOK[i+1]}" in
    "git push")
      VERB="git push"
      # `git push origin lane-x` names it; a bare push moves HEAD.
      local a="${TOK[i+2]}" b="${TOK[i+3]}"
      [[ -n "$b" && "$b" != -* ]] && TARGET="$b"
      [[ -z "$TARGET" && -n "$a" && "$a" != -* ]] && TARGET=""
      break ;;
    "git merge")
      VERB="git merge"; TARGET="${TOK[i+2]}"
      [[ "$TARGET" == -* ]] && TARGET=""
      break ;;
    "gh pr")
      [[ "${TOK[i+2]}" == create ]] || continue
      VERB="gh pr create"
      # `--head <branch>` names the lane from anywhere, and opening a lane's PR
      # while standing on the base branch is the normal way to do it. Falling
      # through to HEAD there would resolve to the base branch, match no
      # dispatch record, and let every PR through.
      integer j
      for (( j = i + 3; j <= $#TOK; j++ )); do
        [[ "${TOK[j]}" == "--head" ]] && { TARGET="${TOK[j+1]}"; break }
        [[ "${TOK[j]}" == --head=* ]] && { TARGET="${TOK[j]#--head=}"; break }
      done
      break ;;
  esac
done
[[ -n "$VERB" ]] || exit 0

[[ -n "$TARGET" ]] || TARGET=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null)
[[ -n "$TARGET" && "$TARGET" != "HEAD" ]] || exit 0
TARGET="${TARGET##*/}"

# A merge is only an outward act when it lands on the branch everything is cut
# from. Merging base INTO a lane is routine and is not gated.
if [[ "$VERB" == "git merge" ]]; then
  local KEY SLUG CFG BASE CUR
  KEY=$(git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  [[ -n "$KEY" ]] || KEY="$CWD"
  SLUG=$(print -rn -- "$KEY" | shasum | cut -c1-12)
  CFG="$HOME/.claude/lirbox-orchestrator/$SLUG.json"
  BASE=$(jq -r '.lanes.base_branch // empty' "$CFG" 2>/dev/null)
  CUR=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null)
  [[ -n "$BASE" && "$CUR" == "$BASE" ]] || exit 0
fi

# ---------------------------------------------------------------------------
# The branch names the lane; the lane names the gate that must exist.
# ---------------------------------------------------------------------------
local REC LANE="" RUNDIR=""
for REC in $RECORDS; do
  [[ "$(jq -r '.branch // empty' "$REC" 2>/dev/null)" == "$TARGET" ]] || continue
  LANE=$(jq -r '.lane // .agent_name // empty' "$REC" 2>/dev/null)
  RUNDIR="${REC:h:h}"
  break
done
# A branch no dispatch record claims is not a lane — the orchestrator's own
# docs branch, a human's. Not this hook's business. This is also the hole: a
# lane whose start never wrote a record is invisible here, which is why the
# record being reliable is a precondition of this gate and not a nicety.
[[ -n "$LANE" ]] || exit 0

# conductor's pass condition exactly: the flag is not trusted alone, a numeric
# build exit has to agree with it. And lanes' own rule on top — a self-report
# can never be a gate, so the producer may not be the implementor.
local IMPL VERDICT
IMPL=$(jq -r '.agent_name // .lane // empty' "$REC" 2>/dev/null)
VERDICT=$(jq -s -r --arg lane "$LANE" --arg impl "$IMPL" '
  [ .[] | (if type == "array" then .[] else . end)
        | select(.kind == "code_gate" and .lane == $lane) ] as $g
  | if ($g | length) == 0 then "MISSING"
    elif ([ $g[] | select(.produced_by != $impl) ] | length) == 0 then "SELF"
    else ([ $g[] | select(.produced_by != $impl) ] | last) as $v
      | if ($v.gate_passed == true and $v.build_exit == 0) then "PASS"
        else "FAIL c=\($v.critical // "?") h=\($v.high // "?") build_exit=\($v.build_exit // "?")"
        end
    end' "$RUNDIR"/evidence/*.json(N) 2>/dev/null)
[[ -n "$VERDICT" ]] || VERDICT="MISSING"

# The DoD is opt-in per SKILL.md §7 — only a run that froze one is held to it.
local DOD="OK"
if [[ -f "$RUNDIR/dod.json" ]]; then
  DOD=$(jq -s -r '
    [ .[] | (if type == "array" then .[] else . end) | select(.kind == "dod_gate") ] as $d
    | if ($d | length) == 0 then "MISSING"
      elif (($d | last).all_passed == true) then "OK"
      else "FAIL \(($d | last).failed // "?")" end' "$RUNDIR"/evidence/*.json(N) 2>/dev/null)
  [[ -n "$DOD" ]] || DOD="MISSING"
fi

# The store has to know this lane is committed.
#
# The gate above proves the code was reviewed; this proves the run recorded it.
# In the 2026-08 run transitions.jsonl stopped two days before the session ended
# and twelve lanes never got a dispatch record — the store was not wrong, it was
# EMPTY, and nothing that arrives as context fixes empty. Only a door does.
#
# Deliberately bounded, because the neighbouring idea is a trap: gating on "the
# ledger is clean" would block every turn end forever, since that ledger is
# append-only with no removal path. This asks one question about ONE lane — the
# one whose branch is being pushed — and a single command answers it.
local RECORDED="OK"
if [[ "$VERDICT" == "PASS" ]]; then
  local TF="$RUNDIR/transitions.jsonl"
  if [[ -s "$TF" ]]; then
    jq -e -s --arg lane "$LANE" 'any(.[]; .lane == $lane and .to == "durable")' \
      "$TF" >/dev/null 2>&1 || RECORDED="NO-DURABLE"
  else
    RECORDED="NO-TRANSITIONS"
  fi
fi

[[ "$VERDICT" == "PASS" && "$DOD" == "OK" && "$RECORDED" == "OK" ]] && exit 0

local LANECMD='${CLAUDE_PLUGIN_ROOT}/scripts/orch-lane.sh'
print -u2 -r -- "DENIED: \`$VERB\` — branch '$TARGET' is lane '$LANE' and it is not gated.

  code_gate   $VERDICT
  dod_gate    $DOD
  recorded    $RECORDED

$(case "$VERDICT" in
  MISSING) print -r -- "  No code_gate artifact for this lane. Run the gate:

    $LANECMD gate $LANE --run ${RUNDIR:t}" ;;
  SELF)    print -r -- "  The only code_gate for this lane was produced by the lane that wrote the
  code. A self-report can never be a gate — the same rule that stops
  reported -> verified. Dispatch the gate as its own lane." ;;
  *)       print -r -- "  The gate ran and did not pass. Unresolved Critical/High, or a build that
  did not exit 0. Fix them and re-run the gate; do not push past it." ;;
esac)
$([[ "$DOD" != "OK" ]] && print -r -- "
  This run froze a definition of done and it is $DOD. Every checkable criterion
  has to pass, against the sha256-locked check files — a weakened check is
  detected, not rewarded.")
$([[ "$RECORDED" != "OK" ]] && print -r -- "
  The gate passed and the store does not know it. '$LANE' has no 'durable' row
  in $RUNDIR/transitions.jsonl, so the board cannot show what you are about to
  push, and a replacement orchestrator would find this lane still open.

    node \${CLAUDE_PLUGIN_ROOT}/skills/lanes/scripts/transition.mjs \\\\
      --root $RUNDIR --lane $LANE --to durable --reason \"...\"

  That command refuses an illegal move rather than recording a false one, so it
  is also the cheapest check that this lane is where you think it is.")

Nothing here is a veto on your judgement. If this genuinely has to go out
ungated, add POLICY-OVERRIDE and the reason to the command, and it passes."
exit 2

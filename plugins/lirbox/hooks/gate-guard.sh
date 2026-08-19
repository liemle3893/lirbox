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

# The run store is probed AFTER the command is parsed, not before. Resolving the
# repo from .cwd alone and exiting early is how `git -C <worktree> push` walked
# straight through: the orchestrator sits in the main repo while every lane
# lives in a worktree, so -C is the NORMAL spelling and .cwd names the wrong
# repo. Measured live — three pushes against a lane with 3 Criticals reached the
# network because this exit fired before anything looked at the command.
typeset -a TOK
TOK=(${(z)CMD})

# ---------------------------------------------------------------------------
# Which outward verb, and which ref it moves.
#
# Parsed structurally, not positionally. The first cut matched on the ADJACENT
# pair `git push` and read the operand from a fixed slot, and every one of these
# walked through a lane with two Criticals and a red build:
#
#   git push -u origin lane-kb          a flag before the remote
#   git push origin HEAD:lane-kb        a refspec
#   git -C <worktree> push origin ...   a git global option — and lanes RUN in
#                                       worktrees, so this is the normal spelling
#   gh pr create -H lane-kb             the short flag
#   gh pr merge lane-kb --squash        no case arm at all
#   git merge --no-ff lane-kb           a flag before the ref
#
# The failure direction was the dangerous one: an unparseable command became
# "this is not a lane" (allow) rather than "I cannot tell" (deny).
# ---------------------------------------------------------------------------
local VERB="" GIT_C=""
integer SKIP_IDX
typeset -a OPERANDS
integer i j

# Global options come before the subcommand. `-C` and `-c` take a value; for gh
# so do `--repo`/`-R`. Skipping them is what makes `git -C <path> push` parse.
# Sets SKIP_IDX (and GIT_C) rather than printing: `$(skip_globals ...)` runs in
# a SUBSHELL, so an assignment inside it never reaches the caller — which is
# exactly how the -C capture silently did nothing on the first attempt.
skip_globals() {
  local -i k=$1
  while (( k <= $#TOK )); do
    case "${TOK[k]}" in
      # -C names the repo this command actually operates on. It is the reason
      # the store must be resolved after parsing, not before.
      -C) GIT_C="${TOK[k+1]}"; (( k += 2 )) ;;
      -c|--repo|-R|--git-dir|--work-tree|--namespace|--exec-path) (( k += 2 )) ;;
      -*) (( k += 1 )) ;;
      *) break ;;
    esac
  done
  SKIP_IDX=$k
}

# Operands are the non-flag tokens after the subcommand. Flags that take a value
# would otherwise donate their argument as a ref.
collect_operands() {
  local -i k=$1
  while (( k <= $#TOK )); do
    case "${TOK[k]}" in
      --repo|-R|-o|--base|-B|--head|-H|--title|-t|--body|-b|--reviewer|-r|--assignee|-a|--label|-l|--milestone|-m|--project|-p|--subject|--strategy)
        # --head/-H names the branch outright; the rest donate nothing.
        [[ "${TOK[k]}" == (--head|-H) ]] && OPERANDS+=("${TOK[k+1]}")
        (( k += 2 )) ;;
      --head=*|-H=*)  OPERANDS+=("${TOK[k]#*=}"); (( k += 1 )) ;;
      --) (( k += 1 )) ;;
      -*) (( k += 1 )) ;;
      *) OPERANDS+=("${TOK[k]}"); (( k += 1 )) ;;
    esac
  done
}

for (( i = 1; i <= $#TOK; i++ )); do
  [[ "${TOK[i]}" == (git|*/git|gh|*/gh) ]] || continue
  local IS_GH=0
  [[ "${TOK[i]}" == (gh|*/gh) ]] && IS_GH=1
  skip_globals $(( i + 1 )); j=$SKIP_IDX

  if (( IS_GH )); then
    [[ "${TOK[j]}" == pr ]] || continue
    skip_globals $(( j + 1 )); j=$SKIP_IDX
    case "${TOK[j]}" in
      create) VERB="gh pr create" ;;
      merge)  VERB="gh pr merge"  ;;
      *) continue ;;
    esac
  else
    case "${TOK[j]}" in
      push)  VERB="git push"  ;;
      merge) VERB="git merge" ;;
      *) continue ;;
    esac
  fi
  collect_operands $(( j + 1 ))
  break
done
[[ -n "$VERB" ]] || exit 0

# NOW resolve the repo — from -C when the command named one, otherwise the
# session cwd — and only then decide whether there is a run store to gate.
[[ -n "$GIT_C" ]] && CWD="$GIT_C"
ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
[[ -n "$ROOT" ]] || exit 0

# In a repo that has never run a lane there is nothing to gate, and this hook
# must be invisible.
typeset -a RECORDS
RECORDS=("$ROOT"/.orchestration/*/dispatch/*.json(N))
(( $#RECORDS )) || exit 0

# A push names a remote then a refspec; a refspec names src:dst and BOTH sides
# can be a lane — `lane-kb:main` writes a lane onto the base branch.
typeset -a CANDIDATES
local o part
for o in $OPERANDS; do
  if [[ "$o" == *:* ]]; then
    for part in ${(s.:.)o}; do CANDIDATES+=("${part##*/}"); done
  else
    CANDIDATES+=("${o##*/}")
  fi
done
# `git push origin` / `gh pr create` with nothing named move the current branch.
local HEADREF
HEADREF=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null)
[[ -n "$HEADREF" && "$HEADREF" != "HEAD" ]] && CANDIDATES+=("${HEADREF##*/}")

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
local REC LANE="" RUNDIR="" TARGET="" cand recbranch
for cand in $CANDIDATES; do
  for REC in $RECORDS; do
    recbranch=$(jq -r '.branch // empty' "$REC" 2>/dev/null)
    [[ -n "$recbranch" && "$recbranch" == "$cand" ]] || continue
    LANE=$(jq -r '.lane // .agent_name // empty' "$REC" 2>/dev/null)
    RUNDIR="${REC:h:h}"
    TARGET="$cand"
    break 2
  done
done

# FAIL CLOSED on `gh pr merge <number>`. A PR number cannot be resolved to a
# lane without the network, and merging a PR is unambiguously an outward act —
# so it is refused rather than waved through. POLICY-OVERRIDE is the escape.
if [[ -z "$LANE" && "$VERB" == "gh pr merge" ]]; then
  for cand in $CANDIDATES; do
    [[ "$cand" == <-> ]] || continue
    print -u2 -r -- "DENIED: \`$VERB $cand\` — a PR number names no branch, so this hook cannot
tell which lane it merges or whether that lane is gated.

Merge by branch so the gate can resolve it, or add POLICY-OVERRIDE and the
reason if you have checked the gate yourself."
    exit 2
  done
fi
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
# The gate is bound to the CODE it reviewed, not merely to the lane. Without
# this, a lane can pass the gate, loop back through implementation — which is
# the whole reason this orchestrator exists rather than a fixed pipeline — commit
# more, and still present the old PASS. A verdict that does not name a sha
# cannot be checked against anything, so it is refused rather than trusted.
local HEADSHA
HEADSHA=$(git -C "$CWD" rev-parse "$TARGET" 2>/dev/null)
VERDICT=$(jq -s -r --arg lane "$LANE" --arg impl "$IMPL" --arg head "$HEADSHA" '
  [ .[] | (if type == "array" then .[] else . end)
        | select(.kind == "code_gate" and .lane == $lane) ] as $g
  | if ($g | length) == 0 then "MISSING"
    elif ([ $g[] | select(.produced_by != $impl) ] | length) == 0 then "SELF"
    else ([ $g[] | select(.produced_by != $impl) ] | last) as $v
      | if ($v.gated_sha == null or $v.gated_sha == "") then "UNBOUND"
        elif ($v.gated_sha != $head) then "STALE gated=\($v.gated_sha[0:8]) head=\($head[0:8])"
        elif ($v.gate_passed == true and $v.build_exit == 0) then "PASS"
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
  UNBOUND) print -r -- "  The gate verdict names no gated_sha, so nothing says WHICH code it
  reviewed. A gate that cannot be tied to a commit cannot be trusted after the
  branch moves. Re-run it:

    $LANECMD gate $LANE --run ${RUNDIR:t}" ;;
  STALE*)  print -r -- "  The gate passed — on a different commit. The branch has moved since it was
  reviewed, so this verdict is about code that is no longer what you are
  pushing. This is the cost of a reshapeable flow: looping back through
  implementation invalidates the gate, and only the sha notices.

    $LANECMD gate $LANE --run ${RUNDIR:t}" ;;
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

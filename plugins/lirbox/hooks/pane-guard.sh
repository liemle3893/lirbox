#!/bin/zsh
# PreToolUse(Bash) — refuse to write into a pane this run did not create.
#
# Typing into a human's pane is unrecoverable: the keystrokes land in someone
# else's session, mid-thought, and no amount of apology gets them back. The
# orchestrator prompt says to leave foreign panes alone; this makes it true.
#
# Guarded are the WRITE verbs only. Reading the world stays free — pane list,
# agent list, agent read, agent get, worktree list are how it orients.
#
# A target is allowed when the ledger holds it: a lane name it started, a pane
# it was given, or a pane/workspace `worktree create` handed back. Anything
# else is denied, including a bare pane id the model inferred from `pane list`.
#
# Parsing is pure zsh on purpose. `grep` on this machine is a shell function in
# some contexts and ugrep in others, and an interpolated ERE through a pipeline
# fails in a way that returns EMPTY rather than erroring out — which would make
# this gate silently allow everything it is meant to stop.

emulate -L zsh
setopt no_nomatch

IN=$(cat)
[[ "$(print -r -- "$IN" | jq -r '.agent_type // ""')" == "lirbox:lirbox-herdr-orchestrator" ]] || exit 0

CMD=$(print -r -- "$IN" | jq -r '.tool_input.command // ""')
[[ "$CMD" == *herdr* ]] || exit 0

CWD=$(print -r -- "$IN" | jq -r '.cwd // ""')
KEY=$(git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[[ -n "$KEY" ]] || KEY="$CWD"
LEDGER="$HOME/.claude/lirbox-lanes/$(print -rn -- "$KEY" | shasum | cut -c1-12).tsv"

# ---------------------------------------------------------------------------
# The spawn door. Creating a lane by hand skips everything orch-lane.sh owns:
# the --cwd pin, the readiness wait, lanes.max_concurrent, lanes.base_branch and
# the dispatch record. In the 2026-08 run that script errored on all 26 of its
# invocations, the orchestrator went raw for the remaining ~130 spawns, and the
# cap in that config — 2 — never ran once while five lanes were live.
#
# This is safe to make absolute because PreToolUse only ever sees commands the
# MODEL issues. orch-lane.sh's own `herdr worktree create` is a child process of
# the script, not a tool call, so the door itself is never knocked on by this.
#
# POLICY-OVERRIDE is the deliberate escape, same as model-policy.sh: a raw spawn
# is a judgement call that has to be said out loud, not a silent detour.
typeset -a T2
T2=(${(z)CMD})
if [[ "$CMD" != *POLICY-OVERRIDE* ]]; then
  integer k
  for (( k = 1; k <= $#T2; k++ )); do
    [[ "${T2[k]}" == (herdr|*/herdr) ]] || continue
    local n2="${T2[k+1]}" v2="${T2[k+2]}"
    if [[ "$n2 $v2" == "agent start" || "$n2 $v2" == "worktree create" ]]; then
      print -u2 -r -- "DENIED: \`herdr $n2 $v2\` by hand. Lanes are created through one command.

  LANE=\${CLAUDE_PLUGIN_ROOT}/scripts/orch-lane.sh

  \$LANE start   <name> --profile <p> --run <slug>   # new worktree + pane + agent
  \$LANE restart <name> --run <slug>                 # re-arm on the lane's existing pane

Doing it by hand skips the source-repo pin, the wait for the pane to reach a
shell prompt, lanes.max_concurrent, lanes.base_branch, and the dispatch record
that is the only way to find this lane again. Each of those was a failure on
record, not a precaution.

Restarting a lane after a /clear, a wedge or a death is \`restart\`, not \`start\` —
\`start\` cuts a second worktree. A /clear also drops the --agent profile, which is
why restarting through the profile is the thing that puts the bounded context back.

If this genuinely cannot go through the script, add POLICY-OVERRIDE and the
reason to the command."
      exit 2
    fi
  done
fi
# ---------------------------------------------------------------------------

typeset -a AGENT_WRITES PANE_WRITES
AGENT_WRITES=(prompt send-keys rename attach)
PANE_WRITES=(send-keys send-text run close rename resize swap move zoom)

# ${(z)...} splits the way the shell would, so quoted prompt text stays one word
# and cannot be mistaken for a target.
typeset -a TOK
TOK=(${(z)CMD})

typeset -a TARGETS
integer i
for (( i = 1; i <= $#TOK; i++ )); do
  [[ "${TOK[i]}" == (herdr|*/herdr) ]] || continue
  local noun="${TOK[i+1]}" verb="${TOK[i+2]}" target="${TOK[i+3]}"
  # NOTE: do not reject a leading `-` here. `worktree remove` names its target
  # with a flag, so a positional-shaped check at this level silently skips the
  # single most destructive command in the set.
  case "$noun" in
    agent) [[ -n "$target" && "$target" != -* ]] && (( ${AGENT_WRITES[(I)$verb]} )) && TARGETS+=("$target") ;;
    pane)  [[ -n "$target" && "$target" != -* ]] && (( ${PANE_WRITES[(I)$verb]}  )) && TARGETS+=("$target") ;;
    # `worktree remove --workspace wX` destroys a checkout and names its target
    # with a flag, not a position. Missing it would let the most destructive
    # command through the one guard meant to stop it.
    worktree)
      [[ "$verb" == remove ]] || continue
      integer j
      for (( j = i + 3; j <= $#TOK; j++ )); do
        [[ "${TOK[j]}" == "--workspace" ]] && { TARGETS+=("${TOK[j+1]}"); break }
        [[ "${TOK[j]}" == --workspace=* ]] && { TARGETS+=("${TOK[j]#--workspace=}"); break }
      done
      ;;
  esac
done

(( $#TARGETS )) || exit 0

typeset -a OWNED_TOKENS DENIED
# `$(<file)` is expanded by zsh even when guarded with `&&`, so an absent ledger
# writes "no such file" to stderr — which reads as a hook malfunction. Use an if
# block and cat.
if [[ -r "$LEDGER" ]]; then
  OWNED_TOKENS=("${(@f)$(cat -- "$LEDGER" 2>/dev/null)}")
fi

local t
for t in $TARGETS; do
  (( ${OWNED_TOKENS[(I)$t]} )) || DENIED+=("$t")
done

(( $#DENIED )) || exit 0

local owned_list
if (( $#OWNED_TOKENS )); then
  owned_list=$(print -l -- $OWNED_TOKENS | sed 's/^/  /')
else
  owned_list="  (nothing — this run has started no lanes yet)"
fi

print -u2 -r -- "DENIED: writing into a pane this run did not create: ${(j:, :)DENIED}

Panes and lanes you own:
$owned_list

Every other pane belongs to a human or another session. Keystrokes sent there
land in someone else's session and cannot be taken back.

If you need a pane, make a lane — \`orch-lane.sh start\` returns a fresh worktree,
pane and agent, and records all three. If you believe you own this one, you have
lost track of it: re-read your dispatch records rather than guessing from
\`pane list\`."
exit 2

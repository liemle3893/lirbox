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

If you need a pane, make one — \`herdr worktree create\` returns a fresh pane and
\`herdr agent start\` claims it. If you believe you own this one, you have lost
track of it: re-read your dispatch records rather than guessing from \`pane list\`."
exit 2

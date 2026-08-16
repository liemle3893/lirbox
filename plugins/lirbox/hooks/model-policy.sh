#!/bin/zsh
# PreToolUse(Bash) — a lane may not be spawned without an explicit harness, and
# the capable harness is reserved for the gates that need it.
#
# The 2026-08 run drifted on its first wave: an implementation lane was started
# on Opus against a stated policy, and the human caught it three turns later.
# The agent prompt's own tier table invites that drift ("Model capability is
# yours"), so the policy is enforced here rather than argued there.
#
# Deny is not a veto on judgement — it is a demand to say so out loud. Add
# POLICY-OVERRIDE to the command with a reason and it passes.

emulate -L zsh

IN=$(cat)
[[ "$(print -r -- "$IN" | jq -r '.agent_type // ""')" == "lirbox:lirbox-herdr-orchestrator" ]] || exit 0

CMD=$(print -r -- "$IN" | jq -r '.tool_input.command // ""')
[[ "$CMD" == *herdr*agent*start* ]] || exit 0
[[ "$CMD" == *POLICY-OVERRIDE* ]] && exit 0

NAME=$(print -r -- "$CMD" | sed -n 's/.*herdr[[:space:]]\{1,\}agent[[:space:]]\{1,\}start[[:space:]]\{1,\}\([^[:space:]]\{1,\}\).*/\1/p' | head -1)

POLICY='Session model policy:
  verifier / criteria-authoring / adjudication  -> --kind claude  (capable)
  every other lane                              -> --kind opencode --model <cheap contributor> --auto

Spend capability where a wrong answer is unrecoverable or invisible, not where
it is expensive. To depart from this deliberately, add POLICY-OVERRIDE plus the
reason to the command.'

if [[ "$CMD" != *--kind* ]]; then
  print -u2 -r -- "DENIED: \`herdr agent start\` with no --kind. Name the harness explicitly.

$POLICY"
  exit 2
fi

if [[ "$CMD" == *"--kind claude"* ]]; then
  if [[ ! "$NAME" =~ '(verif|vf[0-9]|criteria|adjudicat|recon|plan)' ]]; then
    print -u2 -r -- "DENIED: lane '$NAME' is starting on the capable harness, but its name does not
read as a verifier or criteria-authoring lane.

$POLICY"
    exit 2
  fi
fi

exit 0

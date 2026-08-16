#!/bin/zsh
# PreToolUse(Bash) — a lane's harness and model come from its profile, declared
# once per project, never from a judgement made at spawn time.
#
# The 2026-08 run drifted on its first wave: an implementation lane started on
# the capable harness against a stated policy, and the human caught it three
# turns later. The agent prompt's own tier table invites that drift ("Model
# capability is yours"), so the assignment is data now, not a decision.
#
# Config: ~/.claude/lirbox-orchestrator/<repo-key>.json — see scripts/orch-config.sh.
# With no config, only the two universal rules apply: name the harness, name the
# profile. With a config, the profile decides kind and model exactly.
#
# Deny is not a veto on judgement — it is a demand to say so out loud. Add
# POLICY-OVERRIDE plus a reason to the command and it passes.
#
# Parsing is pure zsh. `grep` here is a shell function in some contexts and a
# real binary in others, and an interpolated ERE through a pipeline returns
# EMPTY rather than erroring — which in a deny-by-default gate means allow.

emulate -L zsh
setopt no_nomatch

IN=$(cat)
[[ "$(print -r -- "$IN" | jq -r '.agent_type // ""')" == "lirbox:lirbox-herdr-orchestrator" ]] || exit 0

CMD=$(print -r -- "$IN" | jq -r '.tool_input.command // ""')
[[ "$CMD" == *herdr* ]] || exit 0
[[ "$CMD" == *POLICY-OVERRIDE* ]] && exit 0

typeset -a TOK
TOK=(${(z)CMD})

# Find `herdr agent start`; everything we care about is in that invocation.
integer s=0 i
for (( i = 1; i <= $#TOK; i++ )); do
  [[ "${TOK[i]}" == (herdr|*/herdr) && "${TOK[i+1]}" == agent && "${TOK[i+2]}" == start ]] && { s=$i; break }
done
(( s )) || exit 0

LANE="${TOK[s+3]}"
local KIND="" MODEL="" PROFILE=""
for (( i = s; i <= $#TOK; i++ )); do
  case "${TOK[i]}" in
    --kind)     KIND="${TOK[i+1]}" ;;
    --kind=*)   KIND="${TOK[i]#--kind=}" ;;
    --model)    MODEL="${TOK[i+1]}" ;;
    --model=*)  MODEL="${TOK[i]#--model=}" ;;
    --agent)    PROFILE="${TOK[i+1]}" ;;
    --agent=*)  PROFILE="${TOK[i]#--agent=}" ;;
  esac
done

CWD=$(print -r -- "$IN" | jq -r '.cwd // ""')
KEY=$(git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[[ -n "$KEY" ]] || KEY="$CWD"
CFG="$HOME/.claude/lirbox-orchestrator/$(print -rn -- "$KEY" | shasum | cut -c1-12).json"

deny() { print -u2 -r -- "DENIED: $1"; exit 2 }

# Universal, config or not.
[[ -n "$KIND" ]] || deny "\`herdr agent start $LANE\` names no --kind. Say which harness."
[[ -n "$PROFILE" ]] || deny "lane '$LANE' has no --agent profile. A lane without a bounded-context
profile has no invariants and no ubiquitous language, and will invent both."

if [[ ! -r "$CFG" ]]; then
  # An earlier version allowed this and printed a note. Measured: stderr from a
  # hook that exits 0 never reaches the model, so that note was decoration and
  # nobody ever ran init. Only a deny is heard, so the first spawn is the deny.
  deny "this project has no orchestration config, so no lane can be decided rather than guessed.

  ${CLAUDE_PLUGIN_ROOT:-<plugin>}/scripts/orch-config.sh init

Then fill it WITH THE USER — profiles they want, and which harness and model each
one runs on — before starting any lane. One conversation now replaces a decision
per lane, and a wrong guess here is invisible until it has cost a wave."
fi

WANT=$(jq -r --arg p "$PROFILE" '.profiles[$p] // empty | "\(.kind)\t\(.model // "")"' "$CFG" 2>/dev/null)
if [[ -z "$WANT" ]]; then
  KNOWN=$(jq -r '.profiles | keys | join(", ")' "$CFG" 2>/dev/null)
  deny "profile '$PROFILE' is not declared for this project.
Declared: $KNOWN
Add it to $CFG, or use one that is there. Do not pick a harness to suit the lane."
fi

WANT_KIND="${WANT%%$'\t'*}"
WANT_MODEL="${WANT#*$'\t'}"

[[ "$KIND" == "$WANT_KIND" ]] || deny "profile '$PROFILE' is declared --kind $WANT_KIND, but this spawn says --kind $KIND.
Change the command, or change the profile in $CFG. Not both, and not neither."

if [[ -n "$WANT_MODEL" && -n "$MODEL" && "$MODEL" != "$WANT_MODEL" ]]; then
  deny "profile '$PROFILE' is declared --model $WANT_MODEL, but this spawn says --model $MODEL."
fi
if [[ -n "$WANT_MODEL" && -z "$MODEL" ]]; then
  deny "profile '$PROFILE' is declared --model $WANT_MODEL; this spawn names no model.
Pass it explicitly — an unnamed model is the harness default, which is not a decision."
fi

exit 0

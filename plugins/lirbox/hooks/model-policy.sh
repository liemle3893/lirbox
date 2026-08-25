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

# The harness table: kinds, and which flag carries the profile / model / effort
# on each. Same file orch-lane.sh and orch-config.sh read.
# HARNESS_KINDS_OVERRIDE is the mutation-testing escape hatch scripts/prove-checks.mjs
# needs: a check that guards this table can only be proven if the table it loads
# can be pointed somewhere else. Unset in every real run.
source "${HARNESS_KINDS_OVERRIDE:-${0:h}/../scripts/harness-kinds.sh}"

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

# Which flag means what, derived from the harness table rather than listed here.
# A hardcoded `--agent` was correct while claude and opencode were the only
# harnesses and silently wrong the moment one carried its profile as
# `--append-system-prompt <file>`: the hook saw no --agent, and denied every
# such spawn as having no bounded context. Adding a harness must not mean
# remembering to edit a hook.
typeset -A ROLE
local _k _f
for _k in ${=$(hk_kinds)}; do
  for _f in "${HK_AGENT_FLAG[$_k]-}";  do [[ -n "$_f" ]] && ROLE[$_f]=ctx;    done
  for _f in "${HK_MODEL_FLAG[$_k]-}";  do [[ -n "$_f" ]] && ROLE[$_f]=model;  done
  for _f in "${HK_EFFORT_FLAG[$_k]-}"; do [[ -n "$_f" ]] && ROLE[$_f]=effort; done
done
ROLE[--kind]=kind

local KIND="" MODEL="" PROFILE="" EFFORT="" CTX=""
local tok flag val
for (( i = s; i <= $#TOK; i++ )); do
  tok="${TOK[i]}"
  if [[ "$tok" == *=* && "$tok" == -* ]]; then
    flag="${tok%%=*}"; val="${tok#*=}"
  else
    flag="$tok"; val="${TOK[i+1]}"
  fi
  case "${ROLE[$flag]-}" in
    kind)   KIND="$val" ;;
    model)  MODEL="$val" ;;
    effort) EFFORT="$val" ;;
    ctx)    CTX="$val" ;;
  esac
done

CWD=$(print -r -- "$IN" | jq -r '.cwd // ""')
KEY=$(git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[[ -n "$KEY" ]] || KEY="$CWD"
CFG="$HOME/.claude/lirbox-orchestrator/$(print -rn -- "$KEY" | shasum | cut -c1-12).json"

deny() { print -u2 -r -- "DENIED: $1"; exit 2 }

# Universal, config or not.
[[ -n "$KIND" ]] || deny "\`herdr agent start $LANE\` names no --kind. Say which harness."
[[ -n "$CTX" ]] || deny "lane '$LANE' has no bounded-context profile — no --agent and no
--append-system-prompt. A lane without one has no invariants and no ubiquitous
language, and will invent both."

if [[ ! -r "$CFG" ]]; then
  # An earlier version allowed this and printed a note. Measured: stderr from a
  # hook that exits 0 never reaches the model, so that note was decoration and
  # nobody ever ran init. Only a deny is heard, so the first spawn is the deny.
  deny "this project has no orchestration config, so no lane can be decided rather than guessed.

  ${CLAUDE_PLUGIN_ROOT:-<plugin>}/skills/lane-config/scripts/orch-config.sh init

Then fill it WITH THE USER — profiles they want, and which harness and model each
one runs on — before starting any lane. One conversation now replaces a decision
per lane, and a wrong guess here is invisible until it has cost a wave."
fi

# CTX is what the command line carries: a profile name for the name-carried
# harnesses, and a PATH for the file-carried ones. Resolve it back to a declared
# profile by name first, then by the agent id a profile points at, then by the
# basename of that path. Without this last step every omp spawn looks like an
# undeclared profile called "/Users/.../lirbox-builder.md".
PROFILE="$CTX"
if ! jq -e --arg p "$PROFILE" '.profiles[$p]' "$CFG" >/dev/null 2>&1; then
  local BASE="${CTX:t:r}"
  # Match on the KIND too. Without it, two profiles that share an agent file —
  # the same role declared on two harnesses, which is the normal way to compare
  # them — collapse to whichever jq listed first, and the hook then checks the
  # spawn against a profile it was never meant to be. That reads as a model
  # policy violation on a perfectly correct command.
  local -a CAND
  CAND=(${(f)"$(jq -r --arg c "$CTX" --arg b "$BASE" --arg k "$KIND" '
    .profiles | to_entries
    | map(select(.value.kind == $k))
    | map(select((.value.agent // .key) as $a | $a == $c or $a == $b or .key == $b))
    | .[].key' "$CFG" 2>/dev/null)"})
  if (( $#CAND == 1 )); then
    PROFILE="$CAND[1]"
  elif (( $#CAND > 1 )); then
    # Genuinely ambiguous: same harness, same agent, different profiles. Accept
    # the one this spawn actually matches rather than guessing, and refuse if
    # none matches — a silent pick here would wave through a model nobody chose.
    PROFILE=""
    local c
    for c in "${CAND[@]}"; do
      jq -e --arg p "$c" --arg m "$MODEL" --arg e "$EFFORT" \
        '.profiles[$p] | (((.model // "") == $m) and ((.effort // "") == $e))' \
        "$CFG" >/dev/null 2>&1 && { PROFILE="$c"; break }
    done
    [[ -n "$PROFILE" ]] || deny "lane '$LANE' names agent '$BASE' on --kind $KIND, which matches more
than one declared profile (${(j:, :)CAND}), and this spawn's --model/--effort
matches none of them. Name the profile you mean by starting through
\`orch-lane.sh start --profile <p>\`."
  fi
fi

WANT=$(jq -r --arg p "$PROFILE" '.profiles[$p] // empty | "\(.kind)\t\(.model // "")\t\(.effort // "")"' "$CFG" 2>/dev/null)
if [[ -z "$WANT" ]]; then
  KNOWN=$(jq -r '.profiles | keys | join(", ")' "$CFG" 2>/dev/null)
  deny "profile '$PROFILE' is not declared for this project.
Declared: $KNOWN
Add it to $CFG, or use one that is there. Do not pick a harness to suit the lane."
fi

WANT_KIND=$(print -r -- "$WANT" | cut -f1)
WANT_MODEL=$(print -r -- "$WANT" | cut -f2)
WANT_EFFORT=$(print -r -- "$WANT" | cut -f3)

[[ "$KIND" == "$WANT_KIND" ]] || deny "profile '$PROFILE' is declared --kind $WANT_KIND, but this spawn says --kind $KIND.
Change the command, or change the profile in $CFG. Not both, and not neither."

if [[ -n "$WANT_MODEL" && -n "$MODEL" && "$MODEL" != "$WANT_MODEL" ]]; then
  deny "profile '$PROFILE' is declared --model $WANT_MODEL, but this spawn says --model $MODEL."
fi
if [[ -n "$WANT_MODEL" && -z "$MODEL" ]]; then
  deny "profile '$PROFILE' is declared --model $WANT_MODEL; this spawn names no model.
Pass it explicitly — an unnamed model is the harness default, which is not a decision."
fi

# Reasoning effort is a claude flag. opencode's interactive entry has none
# (--variant is `opencode run` only) and ignores unknown flags silently, so a
# profile may only declare effort on claude — enforced at write time too.
if [[ -n "$WANT_EFFORT" ]]; then
  [[ -n "$EFFORT" ]] || deny "profile '$PROFILE' is declared at effort '$WANT_EFFORT'; this spawn names none.
Use ${CLAUDE_PLUGIN_ROOT:-<plugin>}/scripts/orch-lane.sh start, which emits it for you."
  [[ "$EFFORT" == "$WANT_EFFORT" ]] || deny "profile '$PROFILE' is declared at effort '$WANT_EFFORT', but this spawn says '$EFFORT'."
fi

exit 0

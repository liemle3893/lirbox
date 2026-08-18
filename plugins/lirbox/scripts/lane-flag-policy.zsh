# Lane flag policy — ONE definition, sourced by every place a config string can
# become part of a spawned command line.
#
#   skills/lane-config/scripts/orch-config.sh   write time  (refuse to store it)
#   scripts/orch-lane.sh                        spawn time  (refuse to splice it)
#   hooks/model-policy.sh                       command time (refuse to run it)
#
# Why all three rather than just the first. The orchestrator config lives in
# $HOME, not the repo, so a hostile checkout cannot write it directly — it has to
# get the AGENT to write it, which a README, an issue body or a CI log can try.
# One `orch-config.sh set-profile impl --flags '--dangerously-skip-permissions'`
# and every later lane in that repo spawns with permissions off, silently and
# permanently: model-policy.sh checks --kind/--model/--effort and never looked at
# `flags`, and orch-lane.sh spliced the array in verbatim. Write-time refusal
# alone is not enough either, because the file is a file and can be hand-edited.
# So the gate is on every path, and each one re-derives it from here.
#
#   lane_flags_problem <token>...
#     prints one line per problem to stdout; returns 0 clean, 1 if any problem.
#
# The shape rule is an ALLOWLIST — a flag token may only contain characters that
# are inert in every consumer (no whitespace, no quotes, no $ ` \ ; & | < > ( ),
# no control characters). That is what makes this safe against a consumer we have
# not written yet, and it holds regardless of how the token is spliced.
#
# The name rule is a DENYLIST, and a denylist is never complete — it names the
# flags that grant capability or overturn a decision the profile already made.
# It is the weaker half on purpose: enumerating every acceptable harness flag
# would break the moment claude, opencode or herdr grows one. When you add a
# harness, read its --help and add anything that widens permissions, loads code
# or config, rewrites the system prompt, or re-picks the model.
#
# Names are normalised before matching — lowercased with `-` and `_` stripped —
# so `--allowed-tools`, `--allowedTools` and `--allowed_tools` are one entry.

# Denied wherever it appears — in a stored profile AND on a command line the
# model wrote. Each of these hands the lane a capability, some code, or an
# identity that nobody signed off on.
typeset -ga LANE_FLAG_DENY
LANE_FLAG_DENY=(
  # permission surface
  permissionmode allowedtools disallowedtools
  # loads code or config the user never reviewed
  mcpconfig strictmcpconfig settings settingsources adddir plugindir plugin
  # rewrites who the agent is
  appendsystemprompt systemprompt systempromptfile
  # re-picks the model behind the gate's back: model-policy.sh compares --model
  # and has no idea a fallback exists
  fallbackmodel
)

# Denied in a STORED PROFILE only. On the command line these four are not an
# attack, they are the gate's own subject matter — model-policy.sh reads them and
# compares each against the profile. Inside the profile's `flags` array they are
# a second, unreviewed answer to a question the profile has already answered, and
# whichever the harness happens to honour last is the one that takes effect.
typeset -ga LANE_FLAG_PROFILE_DECIDED
LANE_FLAG_PROFILE_DECIDED=(model kind agent effort)

# Cap the array. A profile carrying 40 flags is not a profile, it is a payload.
typeset -gi LANE_FLAG_MAX=24
typeset -gi LANE_FLAG_MAXLEN=200

lane_flag_normalise() {
  local n="${1#--}"; n="${n%%=*}"
  print -rn -- "${${(L)n}//[-_]/}"
}

# Name-only test, for the one caller that must not apply the shape rule: the
# PreToolUse hook sees a whole command line, and `${(z)}` keeps a quoted prompt
# as a single token — prose that would fail the character allowlist and is not a
# flag at all. Returns 0 (true) when the token names a denied flag.
lane_flag_denied() {
  emulate -L zsh
  local tok="$1" name
  [[ "$tok" == --?* ]] || return 1
  name=$(lane_flag_normalise "$tok")
  [[ "$name" == dangerously* ]] && return 0
  (( ${LANE_FLAG_DENY[(I)$name]} )) && return 0
  return 1
}

lane_flags_problem() {
  emulate -L zsh
  setopt no_nomatch
  integer bad=0 n=0
  local tok name

  if (( $# > LANE_FLAG_MAX )); then
    print -r -- "too many flags ($#); the cap is $LANE_FLAG_MAX"
    bad=1
  fi

  for tok in "$@"; do
    (( n++ ))
    if [[ -z "$tok" ]]; then
      print -r -- "flag #$n is empty"; bad=1; continue
    fi
    if (( ${#tok} > LANE_FLAG_MAXLEN )); then
      print -r -- "flag #$n is ${#tok} chars; the cap is $LANE_FLAG_MAXLEN"; bad=1; continue
    fi
    # The allowlist. One test catches whitespace, newlines, NUL, and every shell
    # metacharacter — which is the point: a token that survives this is inert no
    # matter which consumer splices it.
    if [[ "$tok" == *[^A-Za-z0-9._/:@,=+-]* ]]; then
      print -r -- "flag #$n contains a character that is not allowed in a lane flag: ${(qqq)tok}
    allowed: letters, digits and . _ / : @ , = + -
    Anything else (spaces, quotes, \$ \` \\ ; & | < > parentheses, newlines) is refused
    because it only has meaning to a shell, and a stored flag must be inert."
      bad=1; continue
    fi
    if [[ "$tok" == ---* || "$tok" == "-" || "$tok" == "--" ]]; then
      print -r -- "flag #$n is not a usable token: ${(qqq)tok}"; bad=1; continue
    fi
    [[ "$tok" == --?* ]] || continue          # bare value token: shape-checked above, nothing to name
    if [[ "${${tok#--}%%=*}" != [A-Za-z0-9]*  ]]; then
      print -r -- "flag #$n has no flag name: ${(qqq)tok}"; bad=1; continue
    fi
    name=$(lane_flag_normalise "$tok")
    if [[ "$name" == dangerously* ]]; then
      print -r -- "flag #$n is refused: ${(qqq)tok}
    A flag whose own name says 'dangerously' is never a per-profile default.
    If a lane genuinely needs it, run it by hand and say why, once."
      bad=1; continue
    fi
    if (( ${LANE_FLAG_DENY[(I)$name]} )); then
      print -r -- "flag #$n is refused: ${(qqq)tok}
    It grants a capability or loads something nobody reviewed, so storing it puts
    that decision where it is never read again. See docs/security/untrusted-input.md."
      bad=1; continue
    fi
    if (( ${LANE_FLAG_PROFILE_DECIDED[(I)$name]} )); then
      print -r -- "flag #$n is refused inside a profile: ${(qqq)tok}
    The profile already answers this. Set it with the matching orch-config.sh
    option (--kind / --model / --effort) so the policy hook can see it; a second
    answer hidden in flags is one the gate never compares."
      bad=1; continue
    fi
  done

  return $bad
}

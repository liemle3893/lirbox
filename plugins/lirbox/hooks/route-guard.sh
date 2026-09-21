#!/bin/zsh
# PreToolUse(Bash) — a lane does not start unrouted.
#
# Advisory guidance in this repo does not bind. Prose telling an orchestrator how to size work has
# been walked past repeatedly, which is why intake.mjs on its own would change nothing: the hook is
# the half that matters. gate-guard.sh holds the OUTWARD door (nothing leaves ungated); this holds
# the INWARD one (nothing expensive starts unrouted). Same shape, same escape, opposite end.
#
# What it refuses: `orch-lane.sh start` when .orchestration/<slug>/route.json is absent, or says
# `reject`, or says `scope`. Nothing else. `restart`, `gate`, `brief` and `close` all
# act on a lane that already exists — the decision they would be gating was made at `start`.
#
# Parsing is pure zsh for the reason gate-guard.sh gives at length: `grep` is a shell function in
# some contexts and ugrep in others, and an interpolated ERE through a pipeline returns EMPTY
# rather than erroring, which in a deny-by-default gate silently means allow.
#
# FAIL OPEN, LOUDLY. Every internal error here passes the command through and says on stderr why.
# A hook that wedges the user's tools is worse than the problem it solves — but a hook that
# silently passes is a known failure mode in this repo, so the reason is always printed.

emulate -L zsh
setopt no_nomatch

pass_on_error() {
  print -u2 -r -- "route-guard: PASSING (fail-open) — $1"
  exit 0
}

IN=$(cat) || pass_on_error "could not read the hook payload from stdin"
[[ -n "$IN" ]] || pass_on_error "empty hook payload on stdin"

CMD=$(print -r -- "$IN" | jq -r '.tool_input.command // ""')
(( $? == 0 )) || pass_on_error "jq could not parse the hook payload"

# Deny is a demand to say it out loud, not a veto on judgement — the same escape gate-guard.sh,
# the spawn door and the model policy all use.
[[ "$CMD" == *POLICY-OVERRIDE* ]] && exit 0

typeset -a TOK
TOK=(${(z)CMD})
(( $#TOK )) || exit 0

# ---------------------------------------------------------------------------
# Is this `orch-lane.sh start`, and for which run?
#
# Matched on the script name, not a fixed position: the real spelling in a brief is
# `${CLAUDE_PLUGIN_ROOT}/scripts/orch-lane.sh start ...` and the hook sees that string
# UNEXPANDED, so anchoring on an absolute path would match nothing.
# ---------------------------------------------------------------------------
local SLUG="" FOUND=0
integer i j
for (( i = 1; i <= $#TOK; i++ )); do
  [[ "${TOK[i]}" == (orch-lane.sh|*/orch-lane.sh) ]] || continue
  # The subcommand is the first non-flag token after the script.
  for (( j = i + 1; j <= $#TOK; j++ )); do
    [[ "${TOK[j]}" == -* ]] && continue
    break
  done
  [[ "${TOK[j]}" == start ]] || continue
  FOUND=1
  # --run names the run whose route file governs this start.
  for (( j = j + 1; j <= $#TOK; j++ )); do
    case "${TOK[j]}" in
      --run)   SLUG="${TOK[j+1]}"; break ;;
      --run=*) SLUG="${TOK[j]#*=}";  break ;;
    esac
  done
  break
done
(( FOUND )) || exit 0

# No --run at all: orch-lane.sh itself dies with "start needs --run <slug>", and duplicating that
# refusal here would just be a second voice saying the same thing less well.
[[ -n "$SLUG" ]] || exit 0

CWD=$(print -r -- "$IN" | jq -r '.cwd // ""')
[[ -n "$CWD" ]] || pass_on_error "the hook payload carries no cwd, so no repo can be resolved"
ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
[[ -n "$ROOT" ]] || pass_on_error "'$CWD' is not inside a git repo, so .orchestration/ cannot be located"

local RF="$ROOT/.orchestration/$SLUG/route.json"
local INTAKE='node ${CLAUDE_PLUGIN_ROOT}/scripts/intake.mjs --task <file> --run '"$SLUG"

if [[ ! -f "$RF" ]]; then
  print -u2 -r -- "DENIED: \`orch-lane.sh start\` — run '$SLUG' has no intake route.

  expected  $RF

Intake is the only step in this factory whose answer can be 'no', and a lane
started without it has already assumed the work should happen. Route it first:

    $INTAKE

That call costs a fraction of a cent, always exits 0, and writes the route file
even when it cannot reach the model. If this genuinely has to start unrouted,
add POLICY-OVERRIDE and the reason to the command."
  exit 2
fi

local ROUTE REASON DECIDED_BY
ROUTE=$(jq -r '.route // empty' "$RF" 2>/dev/null)
(( $? == 0 )) || pass_on_error "$RF is not readable as JSON, so its route cannot be read"
[[ -n "$ROUTE" ]] || pass_on_error "$RF carries no .route field"
REASON=$(jq -r '.reason // "(none recorded)"' "$RF" 2>/dev/null)
DECIDED_BY=$(jq -r '.decided_by // "?"' "$RF" 2>/dev/null)

[[ "$ROUTE" == (reject|scope) ]] || exit 0

print -u2 -r -- "DENIED: \`orch-lane.sh start\` — intake routed run '$SLUG' to '$ROUTE'.

  route       $ROUTE
  decided_by  $DECIDED_BY
  because     $REASON
  file        $RF

$(if [[ "$ROUTE" == reject ]]; then
print -r -- "  Intake says this work should not happen, at high confidence. A lane is the
  most expensive thing this repo can spend on a task; spending it on one that
  was refused is the failure mode intake exists to stop."
else
print -r -- "  Intake could not route this yet: 'done' has no command-plus-expected-value,
  the work needs capability this repo's lanes do not have, or the refusal itself
  was uncertain. Restate the task so finishing is checkable, then re-route:

    $INTAKE"
fi)

Nothing here is a veto on your judgement. If this genuinely has to start, add
POLICY-OVERRIDE and the reason to the command, and it passes."
exit 2

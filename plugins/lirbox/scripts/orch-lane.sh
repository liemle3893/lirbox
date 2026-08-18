#!/bin/zsh
# One command per lane operation. Not a recipe for the orchestrator to follow —
# a thing it runs.
#
#   orch-lane.sh start   <name> --profile <p> --run <slug> [--branch <b>] [--base <b>]
#   orch-lane.sh restart <name> --run <slug> [--profile <p>]
#   orch-lane.sh gate    <lane> --run <slug> [--profile <p>]
#   orch-lane.sh brief   <name> <file>
#   orch-lane.sh close   <name>
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

# A refusal that a rehearsal reports instead of enforcing. Named refuse(), not
# gate(): `gate` is a subcommand below, and this is the thing that SOFTENS a
# refusal — one word meaning two opposite things is a 3am problem. `--dry-run` issues
# nothing, so gating it blocks inspection for no gain — but a rehearsal that
# stayed silent would report a start the real one refuses. zsh locals are
# dynamically scoped, so $DRY is the caller's.
refuse() {
  (( ${DRY:-0} )) || die "$1"
  print -u2 -r -- "orch-lane: NOTE — a real start refuses here:
$1"
}

SUB="${1:-}"; shift 2>/dev/null || true
[[ -n "$SUB" ]] || die "usage: orch-lane.sh [start|restart|gate|brief|close] ..."

# Same key as the ledger and the config — see hooks/lane-ledger.sh.
KEY=$(git -C "$PWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[[ -n "$KEY" ]] || KEY="$PWD"
SLUG=$(print -rn -- "$KEY" | shasum | cut -c1-12)
# The repo this run belongs to, resolved once. Every herdr call that could
# otherwise inherit the human's focus takes it explicitly.
ROOT=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null)
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

# herdr on `agent start`: "The pane must be at its interactive shell prompt."
# `worktree create` hands back a pane_id before that is true, so starting the
# agent on the next line races the shell and loses — 8 of the 2026-08 run's 26
# starts died on `agent target pane <id> is not an available shell`.
#
# At-its-prompt has an exact reading: the pane's foreground process group IS the
# shell. Anything else means something is running in front of it. No sleep
# guesses at that; process-info answers it.
wait_shell() {
  local pane="$1" limit="${2:-30}" t=0
  (( limit > 0 )) || limit=30
  while (( t < limit )); do
    h pane process-info --pane "$pane" 2>/dev/null | jq -e '
      .result.process_info
      | (.shell_pid != null) and (.foreground_process_group_id == .shell_pid)' \
      >/dev/null 2>&1 && return 0
    sleep 1; (( t++ ))
  done
  return 1
}

case "$SUB" in

start)
  NAME="${1:-}"; shift 2>/dev/null || true
  [[ -n "$NAME" ]] || die "start needs a lane name"
  # A flag in the name slot swallows the next word, and the loop below then
  # reports THAT word as the bad flag. The real mistake is two arguments back.
  [[ "$NAME" == --* ]] && die "the lane name comes first, before any flag:
  orch-lane.sh start <name> --profile <p> [--branch <b>] [--base <ref>]"
  local PROFILE="" BRANCH="" BASE="" RUN="" DRY=0
  while (( $# )); do
    case "$1" in
      --profile) PROFILE="$2"; shift 2 ;;
      --branch)  BRANCH="$2";  shift 2 ;;
      --base)    BASE="$2";    shift 2 ;;
      --run)     RUN="$2";     shift 2 ;;
      --dry-run|--dry) DRY=1;  shift   ;;
      # These four are the profile's to decide. Naming one on the command line
      # is the per-spawn drift this script exists to stop, so say so instead of
      # answering "unknown flag" to a reasonable-looking request.
      --kind|--model|--effort|--agent)
        die "$1 comes from the profile, not the command line.
  Change it with orch-config.sh set-profile, or start with a different --profile." ;;
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

  # The base was hardcoded to "dev" here. That is correct in the repos that use
  # it and fails everywhere else with `fatal: not a valid object name: 'dev'` —
  # byte-identical to what a missing --cwd produces, so the two defects hid
  # behind one message. It is a decision, like a profile: refuse rather than
  # guess which branch every worktree in this repo is cut from.
  [[ -n "$BASE" ]] || BASE=$(jq -r '.lanes.base_branch // empty' "$CFG")
  [[ -n "$BASE" ]] || die "no lanes.base_branch in $CFG, and no --base given.
  Every worktree is cut from it, so guessing it wrong fails at spawn.
  Set it with the user: ${0:h}/../skills/lane-config/scripts/orch-config.sh set-lanes --base <branch>"
  git rev-parse --verify -q "$BASE" >/dev/null 2>&1 \
    || die "base '$BASE' does not resolve in $ROOT. Fix lanes.base_branch, or pass --base."

  # A lane with no dispatch record cannot be found again after this turn — no
  # pane, no worktree, no sha_at_dispatch, and nothing for `restart` to read.
  # The record used to be written only when --run happened to be passed: the
  # 2026-08 run left 83 records for ~143 starts, and every missing one is a lane
  # that could only be recovered by hand.
  [[ -n "$RUN" ]] || die "start needs --run <slug>: it names the run whose
  .orchestration/<slug>/dispatch/ record makes this lane findable again."

  # The FIRST lane of a run costs a decomposition and a measured baseline.
  #
  # Nothing here used to decide what to work on first, so the ordering predicate
  # was lane AVAILABILITY: "both lanes are free, so I'm putting one on." The
  # 2026-08 run never ran the three-minute suite it had itself declared expired
  # three times, quoted a failure count from a tree that had moved twenty
  # commits, and only converged when the human decomposed the goal by hand — the
  # 10-of-219-test-files partition that reframed the whole day arrived at hour
  # five, from the human, as a question.
  #
  # Both files are cheap and neither is a plan document. items.md is the lane
  # split — numbered items, and which blocks which. baseline.txt is the one
  # measurement that has to exist before anything is attributed to a change: the
  # test command and the exit code it ACTUALLY returned, today, on this tree.
  #
  # Only the first start. Once a lane is dispatched this run has a shape, and
  # re-asking every spawn would be noise that gets satisfied by a stub file.
  local -a PRIOR
  PRIOR=("$ROOT/.orchestration/$RUN/dispatch"/*.json(N))
  if (( ! $#PRIOR )); then
    local PLAN="$ROOT/.orchestration/$RUN/items.md"
    local MEASURED="$ROOT/.orchestration/$RUN/baseline.txt"
    local -a MISSING
    [[ -s "$PLAN" ]]     || MISSING+=("items.md — the lane split: numbered items, and which blocks which")
    [[ -s "$MEASURED" ]] || MISSING+=("baseline.txt — the setup.test command and the exit code it returned")
    if (( $#MISSING )); then
      refuse "the first lane of run '$RUN' needs the run written down first. Missing in
  $ROOT/.orchestration/$RUN/:

$(print -l -- "${MISSING[@]/#/    }")

  Neither is a design doc. Without them the only thing left to order the work by
  is which lane happens to be free, which is how a run spends five hours on the
  hardest coupled thing and never runs the three-minute suite that would have
  partitioned it."
    fi

    # Teeth, but only on files that are there: a rehearsal continues past the
    # refusal above, and reading a file that does not exist would answer with
    # shell noise instead of the point.
    #
    # A gate satisfied by two empty files is a check that cannot fail —
    # the defect class this skill names as its dominant one.
    if (( ! $#MISSING )); then
    #
    # grep is a shell function in some contexts on this machine and ugrep in
    # others, and an interpolated ERE through a pipeline can return EMPTY rather
    # than erroring — which would make these two tests silently pass. Both are
    # done with zsh's own matching for that reason.
    # `=~`, not a glob: the `#` in `[[:space:]]#` needs EXTENDED_GLOB, which is
    # not set here, so as a glob it matches a literal '#' and every numbered
    # item reads as prose. Silent, and it fails toward refusing good input.
    local line HAS_ITEM=0
    for line in ${(f)"$(<"$PLAN")"}; do
      [[ "$line" =~ '^[[:space:]]*[0-9]+[.)]' ]] && { HAS_ITEM=1; break }
    done
    (( HAS_ITEM )) || refuse "$PLAN has no numbered items.
  A goal restated in prose is not a decomposition. One numbered line per item,
  and name what blocks what — concurrency falls out of that, and so does order."

    local MEASURED_BODY=${(L)"$(<"$MEASURED")"}
    [[ "$MEASURED_BODY" =~ 'exit[[:space:]]*[:=][[:space:]]*[0-9]+' ]] \
      || refuse "$MEASURED records no observed exit code.
  Write the command and what it returned, e.g. 'pnpm test  exit: 1  (25 failed)'.
  An exit code is the one line that cannot be written without running the thing.
  Every later 'it is green now' is measured against this number, and a baseline
  taken after the change is not a baseline."
    fi
  fi

  local KIND MODEL FLAGS READY_MS EFFORT
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
  # herdr's --timeout is how long `agent start` waits for the harness to become
  # READY ("default: 30000; max: 300000"). It is not a lane runtime cap. The
  # 2026-08 run's config carried lanes.timeout_ms=1800000 — a runtime intent —
  # and this line fed it straight to that flag. herdr refused with
  # invalid_agent_timeout on all 26 starts, the orchestrator went raw instead,
  # and the lane cap below became unreachable code for the rest of the run.
  # Read the readiness knob by its own name, and clamp to what herdr accepts so
  # a stale config degrades to a slow spawn rather than to no spawn at all.
  READY_MS=$(jq -r '.lanes.ready_timeout_ms // 60000' "$CFG")
  [[ "$READY_MS" == <-> ]] || READY_MS=60000
  (( READY_MS > 300000 )) && READY_MS=300000
  (( READY_MS < 3001 ))   && READY_MS=3001

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
    DA=(agent start "$NAME" --kind "$KIND" --pane '<pane>' --timeout "$READY_MS" -- --agent "$PROFILE")
    [[ -n "$MODEL" ]] && DA+=(--model "$MODEL")
    [[ -n "$EFLAG" ]] && DA+=($EFLAG "$EFFORT")
    [[ -n "$FLAGS" ]] && DA+=(${=FLAGS})
    print -r -- "herdr worktree create --cwd $ROOT --branch $BRANCH --base $BASE --label $NAME --no-focus --json"
    print -r -- "herdr $DA"
    exit 0
  fi

  local WT PANE WS
  # --cwd pins which repo the worktree is cut from. Without it herdr resolves the
  # source from focus state, which belongs to whatever the human last looked at:
  # the 2026-08 run cut three checkouts into another session's repo, and once
  # focus sat on an unrelated project every start died on
  # "not a valid object name: 'dev'" — a base that exists here and not there.
  # The orchestrator hand-patched this by prefixing `workspace focus` to every
  # call. That is the script's job, and it is one flag.
  WT=$(h worktree create --cwd "$ROOT" --branch "$BRANCH" --base "$BASE" \
       --label "$NAME" --no-focus --json) \
    || die "worktree create failed for $BRANCH (base '$BASE' in $ROOT)"
  PANE=$(print -r -- "$WT" | jq -r '.result.root_pane.pane_id // empty')
  WS=$(print -r -- "$WT"   | jq -r '.result.workspace.workspace_id // empty')
  [[ -n "$PANE" ]] || die "worktree create returned no pane_id: $WT"
  own "$NAME" "$PANE" "$WS"

  wait_shell "$PANE" $(( READY_MS / 1000 )) || die "pane $PANE never reached a shell prompt.
  The worktree and pane exist; nothing was started. Check the pane, then rerun
  start — or close it with: herdr pane close $PANE"

  local -a ARGS
  ARGS=(agent start "$NAME" --kind "$KIND" --pane "$PANE" --timeout "$READY_MS" -- --agent "$PROFILE")
  [[ -n "$MODEL" ]] && ARGS+=(--model "$MODEL")
  [[ -n "$EFLAG" ]] && ARGS+=($EFLAG "$EFFORT")
  [[ -n "$FLAGS" ]] && ARGS+=(${=FLAGS})
  h $ARGS >/dev/null || die "agent start failed for $NAME on $PANE"

  if [[ -n "$RUN" ]]; then
    # $ROOT, not PWD. `restart` resolves this path from the repo root, so a
    # start issued from a subdirectory used to file the record where restart
    # would never look — and its refusal reads "no dispatch record … start a
    # fresh lane instead", which turns every wedged pane into a second checkout.
    local D="$ROOT/.orchestration/$RUN/dispatch"
    mkdir -p "$D"
    # `lane` and `worktree` are not decoration: restart reads `.worktree` to
    # find the checkout, to fire the "this tree is gone" guard, and to measure
    # sha_at_restart. Omitted, that read returned empty and restart silently
    # measured the MAIN repo instead of the lane's tree — the comparison against
    # sha_at_dispatch that is supposed to separate a lane that died after
    # committing from one that never started.
    jq -n --arg n "$NAME" --arg p "$PANE" --arg w "$WS" --arg pr "$PROFILE" \
          --arg k "$KIND" --arg m "$MODEL" --arg e "$EFFORT" --arg b "$BRANCH" \
          --arg wt "$(print -r -- "$WT" | jq -r '.result.worktree.path // empty')" \
          --arg sha "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)" \
      '{lane:$n,agent_name:$n,pane_id:$p,workspace_id:$w,worktree:$wt,profile:$pr,kind:$k,model:$m,effort:$e,branch:$b,sha_at_dispatch:$sha,state:"dispatched"}' \
      > "$D/$NAME.json"
  fi

  jq -n --arg n "$NAME" --arg p "$PANE" --arg w "$WS" --arg pr "$PROFILE" --arg k "$KIND" \
        --arg m "$MODEL" --arg b "$BRANCH" --arg path "$(print -r -- "$WT" | jq -r '.result.worktree.path // empty')" \
    '{lane:$n,pane:$p,workspace:$w,profile:$pr,kind:$k,model:$m,branch:$b,worktree:$path}'

  print -u2 -r -- "Setup for this lane's first instruction (setup.* from config):
$(jq -r '.setup | to_entries[] | select(.key|startswith("_")|not) | "  \(.key): \(.value)"' "$CFG")"
  ;;

restart)
  # Re-arm the harness on a lane's EXISTING pane and checkout. This is the other
  # half of spawning and it was missing: across the 2026-08 run there were 143
  # `agent start` calls against 74 `worktree create` calls, so roughly half of
  # all spawns were restarts on a pane that already existed — `dead ->
  # dispatched` and `wedged -> dispatched` in the lanes state table, plus every
  # /clear boundary. `start` cannot serve them: it always cuts a new worktree.
  #
  # It also repairs the defect that cost that run a whole track. A herdr /clear
  # drops the --agent profile back to the harness default, and the pane footer
  # is the only place that shows it: miniapp-s4 ran its BullMQ work as a default
  # agent with no invariants for hours. Restarting through the profile makes the
  # bounded context re-attach with the process.
  NAME="${1:-}"; shift 2>/dev/null || true
  [[ -n "$NAME" ]] || die "restart needs a lane name"
  local PROFILE="" RUN="" FORCE=0
  while (( $# )); do
    case "$1" in
      --profile) PROFILE="$2"; shift 2 ;;
      --run)     RUN="$2";     shift 2 ;;
      --force)   FORCE=1;      shift   ;;
      --kind|--model|--effort|--agent)
        die "$1 comes from the profile, not the command line." ;;
      *) die "unknown flag: $1" ;;
    esac
  done
  [[ -r "$CFG" ]] || die "no config for this repo; cannot resolve a profile."
  [[ -n "$RUN" ]] || die "restart needs --run <slug> to find the dispatch record."
  owned "$NAME" || die "lane '$NAME' is not one this run created. Refusing to restart it."

  local REC="$ROOT/.orchestration/$RUN/dispatch/$NAME.json"
  [[ -r "$REC" ]] || die "no dispatch record at $REC.
  A lane with no record cannot be restarted — there is nothing that says which
  pane or checkout was its. Start a fresh lane instead."

  local PANE WTREE BRANCH
  PANE=$(jq -r '.pane_id // empty'  "$REC")
  WTREE=$(jq -r '.worktree // empty' "$REC")
  BRANCH=$(jq -r '.branch // empty'  "$REC")
  [[ -n "$PROFILE" ]] || PROFILE=$(jq -r '.profile // empty' "$REC")
  [[ -n "$PANE" ]]    || die "the record for '$NAME' names no pane_id."
  [[ -n "$PROFILE" ]] || die "the record for '$NAME' names no profile, and none was given."
  [[ -z "$WTREE" || -d "$WTREE" ]] \
    || die "the checkout this lane worked in is gone: $WTREE
  Its commits may still be on branch '$BRANCH'. Check before starting anything new."

  # A live agent is not something to restart around — that is how two processes
  # end up writing one tree.
  local ST
  ST=$(h agent get "$NAME" 2>/dev/null | jq -r '.result.agent.agent_status // .result.agent_status // "gone"')
  if [[ "$ST" == (working|blocked) ]] && (( ! FORCE )); then
    die "lane '$NAME' still reports $ST. Restarting now starts a second process
  against the same checkout. Free it first (ctrl+c for a wedge, kill -CONT for a
  stopped one), or pass --force having confirmed it is really gone."
  fi

  local KIND MODEL FLAGS EFFORT READY_MS
  KIND=$(jq -r --arg p "$PROFILE" '.profiles[$p].kind // empty' "$CFG")
  [[ -n "$KIND" ]] || die "profile '$PROFILE' is not declared for this project.
  declared: $(jq -r '.profiles | keys | join(", ")' "$CFG")"
  MODEL=$(jq -r --arg p "$PROFILE" '.profiles[$p].model // empty' "$CFG")
  FLAGS=$(jq -r --arg p "$PROFILE" '.profiles[$p].flags // [] | join(" ")' "$CFG")
  EFFORT=$(jq -r --arg p "$PROFILE" '.profiles[$p].effort // empty' "$CFG")
  local EFLAG=""
  if [[ -n "$EFFORT" ]]; then
    [[ "$KIND" == claude ]] || die "profile '$PROFILE' declares effort on an opencode lane."
    EFLAG="--effort"
  fi
  READY_MS=$(jq -r '.lanes.ready_timeout_ms // 60000' "$CFG")
  [[ "$READY_MS" == <-> ]] || READY_MS=60000
  (( READY_MS > 300000 )) && READY_MS=300000
  (( READY_MS < 3001 ))   && READY_MS=3001

  wait_shell "$PANE" $(( READY_MS / 1000 )) \
    || die "pane $PANE is not at a shell prompt, so nothing can be started in it.
  If the old harness is still up, exit it first; then rerun restart."

  local -a ARGS
  ARGS=(agent start "$NAME" --kind "$KIND" --pane "$PANE" --timeout "$READY_MS" -- --agent "$PROFILE")
  [[ -n "$MODEL" ]] && ARGS+=(--model "$MODEL")
  [[ -n "$EFLAG" ]] && ARGS+=($EFLAG "$EFFORT")
  [[ -n "$FLAGS" ]] && ARGS+=(${=FLAGS})
  h $ARGS >/dev/null || die "agent start failed for $NAME on $PANE"

  # The branch moved or it did not, and which one decides whether this lane is
  # resuming or repeating. Keep sha_at_dispatch; record where HEAD is now.
  local NOWSHA
  NOWSHA=$(git -C "${WTREE:-$ROOT}" rev-parse HEAD 2>/dev/null)
  local TMP="$REC.tmp"
  jq --arg s "$NOWSHA" --arg p "$PROFILE" \
     '.sha_at_restart=$s | .profile=$p | .state="dispatched"
      | .restarts=((.restarts // 0) + 1)' "$REC" > "$TMP" && mv "$TMP" "$REC"

  jq -n --arg n "$NAME" --arg p "$PANE" --arg pr "$PROFILE" --arg k "$KIND" \
        --arg m "$MODEL" --arg w "${WTREE:-}" --arg s "$NOWSHA" \
        --argjson r "$(jq -r '.restarts // 1' "$REC")" \
    '{lane:$n,pane:$p,profile:$pr,kind:$k,model:$m,worktree:$w,sha_at_restart:$s,restarts:$r}'
  ;;

gate)
  # Dispatch the code gate for a lane, as its OWN lane.
  #
  # A gate has to be a separate process for the same reason a verification does:
  # a self-report can never be a gate. Producing it in the implementor's pane
  # would satisfy the artifact and none of the point, so this cuts a fresh lane
  # on the gate profile, checked out at the lane's branch.
  #
  # The verdict shape is conductor's, field for field — gate_passed, critical,
  # high, build_cmd, build_exit — because its pass condition is the one that
  # does not go green on the honour system: the flag is never trusted alone, a
  # numeric build exit has to agree with it.
  NAME="${1:-}"; shift 2>/dev/null || true
  [[ -n "$NAME" ]] || die "gate needs the lane name to gate:
  orch-lane.sh gate <lane> --run <slug> [--profile <p>]"
  local RUN="" PROFILE=""
  while (( $# )); do
    case "$1" in
      --run)     RUN="$2";     shift 2 ;;
      --profile) PROFILE="$2"; shift 2 ;;
      *) die "unknown flag: $1" ;;
    esac
  done
  [[ -r "$CFG" ]] || die "no config for this repo; cannot resolve a gate profile."
  [[ -n "$RUN" ]] || die "gate needs --run <slug> to find the lane's dispatch record."

  local REC="$ROOT/.orchestration/$RUN/dispatch/$NAME.json"
  [[ -r "$REC" ]] || die "cannot gate '$NAME': no dispatch record at $REC.
  A lane with no record has no branch to gate and no implementor to be
  independent of. Nothing to do here."

  local BRANCH IMPL
  BRANCH=$(jq -r '.branch // empty' "$REC")
  IMPL=$(jq -r '.agent_name // .lane // empty' "$REC")
  [[ -n "$BRANCH" ]] || die "the record for '$NAME' names no branch."

  # The gate profile is a declared project decision like every other profile.
  [[ -n "$PROFILE" ]] || PROFILE=$(jq -r '.lanes.gate_profile // empty' "$CFG")
  [[ -n "$PROFILE" ]] || die "no lanes.gate_profile in $CFG, and no --profile given.
  The gate runs on a reviewer profile — one that reviews AND fixes Critical/High
  in a pass, then reports counts. Declare it once:
    ${0:h}/../skills/lane-config/scripts/orch-config.sh set-lanes --gate-profile <p>"

  local GLANE="gate-$NAME"
  [[ "$IMPL" != "$GLANE" ]] || die "the gate lane and the implementor cannot be the same agent."

  local EVID="$ROOT/.orchestration/$RUN/evidence"
  mkdir -p "$EVID"

  # Start it on the lane's own branch, not a fresh one: the gate reviews a diff
  # that already exists.
  "$0" start "$GLANE" --profile "$PROFILE" --run "$RUN" --branch "$BRANCH" --base "$BRANCH" \
    || die "could not start the gate lane for '$NAME'."

  local BRIEF="$EVID/$GLANE-brief.md"
  cat > "$BRIEF" <<BRIEFEOF
Gate the diff on branch \`$BRANCH\` (lane \`$NAME\`). You did not write this code.

Review it, and FIX every Critical and High finding in the same pass. Then build.

Write your verdict to $EVID/$GLANE-code_gate.json — exactly these fields:

{
  "kind": "code_gate",
  "lane": "$NAME",
  "produced_by": "$GLANE",
  "gate_passed": <true only if every Critical and High is fixed, or skipped with
                  an explicit reason recorded below, AND the build exits 0>,
  "critical": <count still UNRESOLVED after your fixes; 0 when gate_passed>,
  "high":     <count still UNRESOLVED after your fixes; 0 when gate_passed>,
  "build_cmd":  "<the command you ran>",
  "build_exit": <its ACTUAL numeric exit code>,
  "skipped":  [ { "title": "...", "reason": "..." } ],
  "summary":  "one line"
}

build_exit is read, not taken on trust: the gate cannot pass with a non-zero
build no matter what gate_passed says. Report the exit code you observed — a
gate that reports 0 for a build it did not run is the one failure this whole
mechanism exists to stop.

Red means stop and report observed values. Do not weaken an assertion, delete a
test, or relax a check to reach green.
BRIEFEOF

  "$0" brief "$GLANE" "$BRIEF" || die "gate lane '$GLANE' started but the brief did not submit."
  print -r -- "gate dispatched: $GLANE reviewing $BRANCH (lane $NAME)
  verdict -> $EVID/$GLANE-code_gate.json"
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

  # Uncommitted work in the lane's checkout is work only that pane knew about.
  # PRINT IT FIRST, unconditionally.
  #
  # This used to sit below the working/blocked refusal and behind the same
  # `! FORCE` guard. But --force is the ONLY way past that refusal, so for a
  # WORKING lane — the single case where closing abandons anything — the listing
  # could never be reached. The guard existed and was unreachable in the
  # situation it was written for. A verifier lane killed mid-task in the 2026-08
  # run left an unrestored red-arm mutant in its tree with nothing pointing at
  # it; it surfaced hours later, and only because a disk audit walked that path.
  local WT DIRTY
  WT=$(print -r -- "$ROW" | jq -r '.cwd // empty')
  if [[ -n "$WT" && -d "$WT" ]]; then
    DIRTY=$(git -C "$WT" status --short 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$DIRTY" != 0 ]]; then
      print -u2 -r -- "lane '$NAME' has $DIRTY uncommitted change(s) in $WT:
$(git -C "$WT" status --short 2>/dev/null | sed 's/^/  /')"
    fi
  fi

  # Closing a pane kills the agent in it. Doing that to a lane still mid-task
  # destroys whatever only that pane holds — the md's rule is that a pane is
  # cleared once its work is durable, never before.
  if [[ "$ST" == (working|blocked) ]] && (( ! FORCE )); then
    die "lane '$NAME' is $ST, not finished. Closing now kills the agent mid-task.
  Wait for it to land, or pass --force if you have confirmed its work is durable."
  fi

  # The listing above is information; this is still a veto. Only --force passes.
  if [[ -n "$DIRTY" && "$DIRTY" != 0 ]] && (( ! FORCE )); then
    die "lane '$NAME' is $ST but its checkout has $DIRTY uncommitted change(s):
  $WT
  Get them committed, or pass --force to close anyway."
  fi

  h pane close "$PANE" >/dev/null || die "pane close failed for $PANE"
  print -r -- "closed $NAME ($PANE, was $ST); worktree left intact"
  ;;

*) die "unknown subcommand: $SUB" ;;
esac

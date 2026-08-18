#!/bin/zsh
# Per-project orchestration config: the primitives. The interview that fills it
# lives in the `lane-config` skill — this file never guesses on the user's
# behalf, it only reports what is knowable and writes what it is told.
#
#   orch-config.sh path     [repo]              print the config path
#   orch-config.sh show     [repo]              print it, or say it is absent
#   orch-config.sh detect   [repo]              JSON of what can be measured here
#   orch-config.sh init     [repo]              write a skeleton (NO invented profiles)
#   orch-config.sh validate [repo]              exit 1 with reasons if unusable
#   orch-config.sh set-profile <name> --kind K --model M [--effort E] [--flags "a b"] [repo]
#   orch-config.sh set-lanes [--max N] [--timeout MS] [--context N] [repo]
#   orch-config.sh set-setup [--install C] [--build C] [--test C] [--baseline S] [repo]
#
# Stored user-local, keyed by the repo's git common dir — the same key the lane
# ledger uses, so one repo has one config no matter which worktree or
# subdirectory the orchestrator happens to be standing in.

emulate -L zsh
setopt no_nomatch

die() { print -u2 -r -- "orch-config: $1"; exit 1 }

SUB="${1:-path}"; shift 2>/dev/null || true

# Trailing arg may be a repo path; anything starting with - is a flag.
REPO="$PWD"
if (( $# )) && [[ "${@[-1]}" != -* && -d "${@[-1]}" ]]; then
  REPO="${@[-1]}"; set -- "${@[1,-2]}"
fi

# The git invocation here must match the one in hooks/*.sh. --path-format=absolute
# is load-bearing: without it git answers `.git` from a repo root and
# `../../.git` from a subdir, so unrelated repos collide and one repo splits
# across three keys.
KEY=$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[[ -n "$KEY" ]] || KEY="$REPO"

DIR="$HOME/.claude/lirbox-orchestrator"
CFG="$DIR/$(print -rn -- "$KEY" | shasum | cut -c1-12).json"

# One definition of what a lane flag may be, shared with scripts/orch-lane.sh
# (spawn time) and hooks/model-policy.sh (command time) so the three cannot
# drift. Fail closed: without it this script cannot tell a flag from a payload.
POLICY="${0:A:h}/../../../scripts/lane-flag-policy.zsh"
[[ -r "$POLICY" ]] || die "missing flag policy at $POLICY — refusing to write a config unchecked."
source "$POLICY"

# --- shape guards -------------------------------------------------------------
# Every value below ends up as an argv token in a spawned command line, a jq key,
# or a line of a brief. The tests are negative and character-based on purpose: a
# value that survives one is inert in all three, whatever splices it next.
bad_name()  { [[ -z "$1" || ${#1} -gt 64  || "$1" == *[^A-Za-z0-9._-]*     || "$1" == [-.]* ]] }
bad_model() { [[ -z "$1" || ${#1} -gt 128 || "$1" == *[^A-Za-z0-9._/:@+-]* ]] }
# setup.* ARE commands — a lane is told to run them — so their content is the
# user's business. What is refused is a second line, which turns one reviewed
# command into two, only one of which anybody read.
bad_cmd()   { [[ ${#1} -gt 4096 || "$1" == *[$'\n\r']* || "$1" == *[$'\001'-$'\010']* ]] }
int_in() {  # int_in <label> <value> <min> <max> — prints a reason, returns 1
  local lbl="$1" v="$2"; integer lo="$3" hi="$4"
  if [[ -z "$v" || "$v" == *[^0-9]* ]]; then
    print -r -- "$lbl must be a whole number, got: ${(qqq)v}"; return 1
  fi
  if (( v < lo || v > hi )); then print -r -- "$lbl must be between $lo and $hi, got $v"; return 1; fi
  return 0
}

# Fail closed. The old body ran `print -r -- "$1" > "$CFG"` unconditionally: when
# the jq that produced "$1" failed — `set-lanes --max oops` was enough — it wrote
# an empty string over a working config and exited 0. Nothing said so until the
# next spawn was denied for a config that "did not parse".
write() {
  print -r -- "$1" | jq -e . >/dev/null 2>&1 \
    || die "refusing to write $CFG: the new content is not valid JSON.
  Nothing was changed. Check the arguments you passed — this is what a failed
  jq upstream looks like, and writing it would destroy the config."
  mkdir -p "$DIR"
  local tmp="$CFG.new.$$"
  print -r -- "$1" > "$tmp" || { rm -f "$tmp"; die "could not write $tmp" }
  mv -f "$tmp" "$CFG" || { rm -f "$tmp"; die "could not replace $CFG" }
}
need()  { [[ -r "$CFG" ]] || die "no config at $CFG — run \`orch-config.sh init\` first." }

case "$SUB" in

path) print -r -- "$CFG" ;;

show)
  [[ -r "$CFG" ]] || { print -r -- "# no config for $REPO"; print -r -- "# expected at: $CFG"; exit 1 }
  print -r -- "# $CFG"; cat -- "$CFG" ;;

detect)
  # Only what can be measured. Profiles are NOT guessed — which harness a class
  # of work deserves is a judgement the user makes once, not one inferred from
  # a lockfile.
  local pm="" install="" build="" test=""
  if   [[ -f "$REPO/pnpm-lock.yaml"    ]]; then pm=pnpm;   install="pnpm install --frozen-lockfile"; build="pnpm -r build"; test="pnpm -r test"
  elif [[ -f "$REPO/yarn.lock"         ]]; then pm=yarn;   install="yarn install --immutable";       build="yarn build";    test="yarn test"
  elif [[ -f "$REPO/package-lock.json" ]]; then pm=npm;    install="npm ci";                         build="npm run build"; test="npm test"
  elif [[ -f "$REPO/bun.lockb"         ]]; then pm=bun;    install="bun install --frozen-lockfile";  build="bun run build"; test="bun test"
  elif [[ -f "$REPO/Cargo.toml"        ]]; then pm=cargo;  install="cargo fetch";                    build="cargo build";   test="cargo test"
  elif [[ -f "$REPO/go.mod"            ]]; then pm=go;     install="go mod download";                build="go build ./..."; test="go test ./..."
  fi
  local ncpu; ncpu=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
  # opencode is commonly installed outside PATH (~/.opencode/bin). An empty
  # profile list because the binary was not found is a broken probe, not a
  # project with no profiles — look where it actually lives before concluding.
  local OC=""
  for c in "${OPENCODE_BIN:-}" "$(command -v opencode 2>/dev/null)" "$HOME/.opencode/bin/opencode"; do
    [[ -n "$c" && -x "$c" ]] && { OC="$c"; break }
  done
  local profiles='[]'
  if [[ -n "$OC" ]]; then
    # Agent names are the non-indented lines; the indented remainder is a JSON
    # permission blob that would otherwise be scraped as names.
    profiles=$("$OC" agent list 2>/dev/null \
      | grep -E '^[a-z][a-z0-9_-]*( |$)' | awk '{print $1}' | sort -u \
      | jq -R . | jq -s . 2>/dev/null || print -r -- '[]')
  fi
  jq -n --arg pm "$pm" --arg i "$install" --arg b "$build" --arg t "$test" \
        --argjson cpu "$ncpu" --argjson prof "$profiles" --arg cfg "$CFG" --arg repo "$REPO" \
    --arg oc "$OC" '{repo:$repo, config_path:$cfg, package_manager:(if $pm=="" then null else $pm end),
      setup:{install:(if $i=="" then null else $i end), build:(if $b=="" then null else $b end),
             test:(if $t=="" then null else $t end)},
      cpus:$cpu, suggested_max_concurrent:(($cpu/2)|floor),
      profiles_discovered:$prof, opencode_bin:(if $oc=="" then null else $oc end),
      effort_flag:{claude:"--effort", opencode:null},
      effort_note:"the interactive opencode entry has no effort flag: --variant belongs to opencode run only, and unknown flags are ignored silently",
      note:"profiles and setup.baseline are decisions, not measurements — ask the user"}' ;;

init)
  [[ -e "$CFG" ]] && die "refusing to overwrite $CFG (use set-profile / set-lanes / set-setup)"
  local d; d=$("$0" detect "$REPO")
  write "$(jq -n --argjson d "$d" '{
    version: 1,
    _comment: "Profiles are empty on purpose. A lane cannot start until at least one is declared, so the decision is made once, with the user, instead of guessed per spawn.",
    profiles: {},
    default_profile: null,
    lanes: { max_concurrent: ($d.suggested_max_concurrent // 4), timeout_ms: 120000, context_cap_tokens: 300000 },
    setup: {
      install: $d.setup.install, build: $d.setup.build, test: $d.setup.test,
      baseline: null
    }
  }')"
  print -r -- "wrote $CFG"
  print -r -- "NOT USABLE YET: no profiles declared. Add them with set-profile." ;;

validate)
  need
  local -a problems
  jq -e . "$CFG" >/dev/null 2>&1 || die "$CFG is not valid JSON"

  # ---- schema ---------------------------------------------------------------
  # "Never hand-edit the JSON" is a rule, and a rule is not a mechanism. This is
  # the mechanism: every shape the set-* subcommands refuse at write time is
  # re-derived here from the file itself, so a config that arrived by some other
  # route — an editor, a script, an agent following a README — is caught by the
  # command the flow already runs before any lane spawns against it.
  local -a schema
  schema=(${(f)"$(jq -r '
    def top: ["version","_comment","profiles","default_profile","lanes","setup"];
    def pkeys: ["kind","model","flags","effort"];
    [ (keys[] | select(. as $k | top | index($k) | not) | "unknown top-level key \(.) — this config did not come from set-profile/set-lanes/set-setup")
    , (if (.profiles|type) != "object" then "profiles is not an object" else empty end)
    , (if (.lanes != null and (.lanes|type) != "object") then "lanes is not an object" else empty end)
    , (if (.setup != null and (.setup|type) != "object") then "setup is not an object" else empty end)
    , ( (if (.profiles|type) == "object" then .profiles else {} end) | to_entries[] as $e
        | $e.key as $p | $e.value as $v
        | ( if ($v|type) != "object" then "profile \($p) is not an object"
            else ( ($v | keys[] | select(. as $k | pkeys | index($k) | not) | "profile \($p): unknown key \(.)")
                 , (if ($v.flags != null and ($v.flags|type) != "array") then "profile \($p): flags is not an array" else empty end)
                 , ((if ($v.flags|type) == "array" then $v.flags else [] end) | .[] | select(type != "string") | "profile \($p): flags holds a non-string \(tojson)")
                 )
            end ) )
    , ( (if (.lanes|type) == "object" then .lanes else {} end) | to_entries[]
        | select((.value|type) != "number" or (.value != (.value|floor)))
        | "lanes.\(.key) is not a whole number: \(.value|tojson)" )
    , ( (if (.setup|type) == "object" then .setup else {} end) | to_entries[]
        | select(.value != null and (.value|type) != "string")
        | "setup.\(.key) is not a string: \(.value|tojson)" )
    ] | .[]' "$CFG" 2>/dev/null)"})
  (( $#schema )) && problems+=("${schema[@]}")

  # Per-value policy, in zsh, from the SAME helpers set-profile writes through —
  # so what validate blesses and what set-profile stores can never disagree.
  local prof m fp r lv sk sv
  typeset -a pf
  for prof in ${(f)"$(jq -r '(if (.profiles|type)=="object" then .profiles else {} end) | keys[]' "$CFG" 2>/dev/null)"}; do
    [[ -n "$prof" ]] || continue
    bad_name  "$prof" && problems+=("profile name $prof is not usable: letters, digits and . _ - only")
    m=$(jq -r --arg p "$prof" '.profiles[$p].model // ""' "$CFG")
    [[ -z "$m" ]] || { bad_model "$m" && problems+=("profile $prof: model $m carries characters that cannot appear in an argv token") }
    pf=(${(f)"$(jq -r --arg p "$prof" '(if (.profiles[$p].flags|type)=="array" then .profiles[$p].flags else [] end) | .[] | select(type=="string") | .' "$CFG" 2>/dev/null)"})
    pf=(${pf:#})
    if (( $#pf )); then
      fp=$(lane_flags_problem "${pf[@]}") \
        || problems+=("profile $prof: ${fp//$'\n'/ }")
    fi
  done

  # A number that parses is not a number that makes sense. A max_concurrent of
  # 0 denies every spawn; one of 10000 is a fork bomb with a config file in front
  # of it. Both are "valid JSON".
  lv=$(jq -r '.lanes.max_concurrent // empty' "$CFG");     [[ -z "$lv" ]] || { r=$(int_in "lanes.max_concurrent" "$lv" 1 256) || problems+=("$r") }
  lv=$(jq -r '.lanes.timeout_ms // empty' "$CFG");         [[ -z "$lv" ]] || { r=$(int_in "lanes.timeout_ms" "$lv" 1000 86400000) || problems+=("$r") }
  lv=$(jq -r '.lanes.context_cap_tokens // empty' "$CFG"); [[ -z "$lv" ]] || { r=$(int_in "lanes.context_cap_tokens" "$lv" 1000 100000000) || problems+=("$r") }

  for sk in install build test baseline; do
    sv=$(jq -r --arg k "$sk" '.setup[$k] // ""' "$CFG")
    [[ -n "$sv" ]] || continue
    bad_cmd "$sv" && problems+=("setup.$sk spans more than one line — a brief pastes it as a single command")
  done
  local n; n=$(jq -r '.profiles | length' "$CFG")
  (( n > 0 )) || problems+=("no profiles declared — every spawn will be denied")
  local bad
  bad=$(jq -r '.profiles | to_entries[] | select((.value.kind // "") | IN("claude","opencode") | not) | .key' "$CFG")
  [[ -z "$bad" ]] || problems+=("profile(s) with missing/unknown kind (want claude|opencode): $bad")
  bad=$(jq -r '.profiles | to_entries[] | select((.value.model // "") == "") | .key' "$CFG")
  [[ -z "$bad" ]] || problems+=("profile(s) with no model: $bad — an unnamed model is the harness default, not a decision")
  bad=$(jq -r '.profiles | to_entries[] | select((.value.effort // "") != "" and .value.kind != "claude") | .key' "$CFG")
  [[ -z "$bad" ]] || problems+=("profile(s) declaring effort on a non-claude harness: $bad — the interactive opencode entry has no effort flag, so it would be silently ignored")
  local dp; dp=$(jq -r '.default_profile // ""' "$CFG")
  if [[ -n "$dp" ]]; then
    jq -e --arg p "$dp" '.profiles[$p]' "$CFG" >/dev/null 2>&1 || problems+=("default_profile '$dp' is not a declared profile")
  fi
  [[ "$(jq -r '.setup.baseline // ""' "$CFG")" != "" ]] || problems+=("setup.baseline is empty — a lane cannot tell a real red from an inherited one")
  if (( ${#problems} )); then
    print -u2 -r -- "config at $CFG is not usable:"
    printf '  - %s\n' "${problems[@]}" >&2
    exit 1
  fi
  print -r -- "config OK: $n profile(s), $CFG" ;;

set-profile)
  need
  local NAME="${1:-}"; shift 2>/dev/null || true
  [[ -n "$NAME" && "$NAME" != -* ]] || die "set-profile needs a profile name"
  local KIND="" MODEL="" FLAGS="" EFFORT=""
  while (( $# )); do
    case "$1" in
      --kind)   KIND="$2";   shift 2 ;;
      --model)  MODEL="$2";  shift 2 ;;
      --flags)  FLAGS="$2";  shift 2 ;;
      --effort) EFFORT="$2"; shift 2 ;;
      *) die "unknown flag: $1" ;;
    esac
  done
  [[ "$KIND" == (claude|opencode) ]] || die "set-profile needs --kind claude|opencode (got '${KIND:-none}')"
  [[ -n "$MODEL" ]] || die "set-profile needs --model. An unnamed model is the harness default, not a decision."
  bad_name "$NAME" && die "profile name '$NAME' is not usable: letters, digits and . _ - only, 64 chars max,
  not starting with - or . — it becomes a jq key and a --agent argv token."
  bad_model "$MODEL" && die "model '$MODEL' is not usable: letters, digits and . _ / : @ + - only, 128 chars max.
  It is spliced into a spawned command line, so it may not carry whitespace or shell syntax."
  # Reasoning effort is a claude flag. opencode's INTERACTIVE entry — the one
  # herdr starts — has no equivalent: --variant exists only on `opencode run`,
  # and the tui silently ignores unknown flags. Storing effort for an opencode
  # profile would emit a flag that does nothing and report success.
  if [[ -n "$EFFORT" ]]; then
    [[ "$KIND" == claude ]] || die "effort is not settable on an opencode lane.
  --variant exists on \`opencode run\` but not on the interactive entry herdr starts,
  and unknown flags are ignored without error. Leave it unset rather than store
  something that cannot take effect."
    [[ "$EFFORT" == (low|medium|high|xhigh|max) ]] || die "unknown effort '$EFFORT' (want: low medium high xhigh max)"
  fi
  # `flags` is the one field that becomes argv the policy hooks never see:
  # orch-lane.sh splices it into `herdr agent start ... -- --agent <p> <flags>`,
  # and model-policy.sh only ever compared --kind/--model/--effort. So a single
  # stored `--dangerously-skip-permissions` turned every later lane in the repo
  # into an ungated one, permanently and with nothing printing a word about it.
  # An agent can be talked into running one set-profile by a README; it should
  # not be able to make that stick.
  typeset -a FLAG_TOK; FLAG_TOK=(${=FLAGS})
  if (( $#FLAG_TOK )); then
    local problems; problems=$(lane_flags_problem "${FLAG_TOK[@]}") || die "--flags refused:
$problems"
  fi
  local fj; fj=$(print -l -- "${FLAG_TOK[@]}" | grep -v '^$' | jq -R . | jq -s . 2>/dev/null || print -r -- '[]')
  write "$(jq --arg n "$NAME" --arg k "$KIND" --arg m "$MODEL" --arg e "$EFFORT" --argjson f "$fj" \
    '.profiles[$n] = ({kind:$k, model:$m}
        + (if ($f|length)>0 then {flags:$f} else {} end)
        + (if $e != "" then {effort:$e} else {} end))
     | .default_profile = (.default_profile // $n)' "$CFG")"
  print -r -- "profile '$NAME' = $KIND / $MODEL${EFFORT:+ / effort=$EFFORT}${FLAGS:+ / $FLAGS}" ;;

set-lanes)
  need
  local MAX="" TO="" CTX=""
  while (( $# )); do
    case "$1" in
      --max) MAX="$2"; shift 2 ;; --timeout) TO="$2"; shift 2 ;; --context) CTX="$2"; shift 2 ;;
      *) die "unknown flag: $1" ;;
    esac
  done
  # --argjson takes whatever it is handed. `--max oops` made jq exit non-zero,
  # `j` become the empty string, and the old write() truncate the config to
  # nothing while reporting success. Validate first; --argjson only ever sees a
  # value already known to be a plain integer in range.
  local reasons=""
  [[ -n "$MAX" ]] && { reasons+=$(int_in "lanes.max_concurrent (--max)"     "$MAX" 1     256)       || true }
  [[ -n "$TO"  ]] && { reasons+=$(int_in "lanes.timeout_ms (--timeout)"     "$TO"  1000  86400000)  || true }
  [[ -n "$CTX" ]] && { reasons+=$(int_in "lanes.context_cap_tokens (--context)" "$CTX" 1000 100000000) || true }
  [[ -z "$reasons" ]] || die "set-lanes refused:
  $reasons"

  local j; j=$(cat -- "$CFG")
  [[ -n "$MAX" ]] && j=$(print -r -- "$j" | jq --argjson v "$MAX" '.lanes.max_concurrent=$v')
  [[ -n "$TO"  ]] && j=$(print -r -- "$j" | jq --argjson v "$TO"  '.lanes.timeout_ms=$v')
  [[ -n "$CTX" ]] && j=$(print -r -- "$j" | jq --argjson v "$CTX" '.lanes.context_cap_tokens=$v')
  write "$j"; jq -c '.lanes' "$CFG" ;;

set-setup)
  need
  local I="" B="" T="" BL=""
  while (( $# )); do
    case "$1" in
      --install) I="$2"; shift 2 ;; --build) B="$2"; shift 2 ;;
      --test) T="$2"; shift 2 ;;   --baseline) BL="$2"; shift 2 ;;
      *) die "unknown flag: $1" ;;
    esac
  done
  # setup.* are commands by design — a lane brief tells the agent to run them, so
  # what they DO is the user's decision, not this script's. What is refused is a
  # second line: one reviewed command that arrives carrying another underneath it
  # is two commands, and only one of them was ever read out loud.
  local k v
  for k v in install "$I" build "$B" test "$T" baseline "$BL"; do
    [[ -n "$v" ]] || continue
    bad_cmd "$v" && die "setup.$k spans more than one line (or is over 4096 chars).
  A setup value is pasted into a lane brief as a single command. Give one command,
  or put the sequence in a script and name the script."
  done

  local j; j=$(cat -- "$CFG")
  [[ -n "$I"  ]] && j=$(print -r -- "$j" | jq --arg v "$I"  '.setup.install=$v')
  [[ -n "$B"  ]] && j=$(print -r -- "$j" | jq --arg v "$B"  '.setup.build=$v')
  [[ -n "$T"  ]] && j=$(print -r -- "$j" | jq --arg v "$T"  '.setup.test=$v')
  [[ -n "$BL" ]] && j=$(print -r -- "$j" | jq --arg v "$BL" '.setup.baseline=$v')
  write "$j"; jq -c '.setup' "$CFG" ;;

*) die "usage: orch-config.sh [path|show|detect|init|validate|set-profile|set-lanes|set-setup] [args] [repo]" ;;
esac

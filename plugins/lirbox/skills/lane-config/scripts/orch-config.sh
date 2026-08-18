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
#   orch-config.sh set-lanes [--max N] [--timeout MS] [--context N] [--gate-profile P] [repo]
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

write() { mkdir -p "$DIR"; print -r -- "$1" > "$CFG" }
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
  # Which branch lanes are cut from. orch-lane.sh used to hardcode "dev", which
  # is right in exactly the repos that use it and fails everywhere else with
  # `fatal: not a valid object name: 'dev'` — the same message a missing --cwd
  # produces, so the two hid behind each other. Ask git: the remote's default
  # head first, then the local branches people actually integrate on.
  # Order matters and origin/HEAD is NOT first: cloudflare-os integrates on dev
  # while its origin/HEAD says main, so the remote's opinion would have written
  # the wrong branch into the config with full confidence. What someone actually
  # has checked out is the better signal. This stays a SUGGESTION either way —
  # init leaves base_branch null and orch-lane.sh refuses to start without it,
  # because the branch every worktree is cut from is a decision, like a profile.
  # main leads every blind list. An earlier cut scanned `dev develop main master`
  # and that is the original defect one level up: a house convention treated as a
  # fact about all repos. Where there is no evidence, the ecosystem default wins.
  local base="" cur c
  cur=$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null)
  # Evidence beats the default: a checked-out integration branch is someone
  # having already answered this. cloudflare-os sits on dev while its
  # origin/HEAD says main, and only this rule gets that repo right.
  for c in main master dev develop; do
    [[ "$cur" == "$c" ]] && { base="$cur"; break }
  done
  if [[ -z "$base" ]]; then
    base=$(git -C "$REPO" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)
    base="${base#origin/}"
  fi
  if [[ -z "$base" ]]; then
    for c in main master dev develop; do
      git -C "$REPO" rev-parse --verify -q "$c" >/dev/null 2>&1 && { base="$c"; break }
    done
  fi
  [[ -n "$base" ]] || base="$cur"

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
    --arg oc "$OC" --arg base "$base" '{repo:$repo, config_path:$cfg, suggested_base_branch:$base, package_manager:(if $pm=="" then null else $pm end),
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
    lanes: { max_concurrent: ($d.suggested_max_concurrent // 4), ready_timeout_ms: 60000,
             context_cap_tokens: 300000, base_branch: null },
    setup: {
      install: $d.setup.install, build: $d.setup.build, test: $d.setup.test,
      baseline: null
    }
  }')"
  print -r -- "wrote $CFG"
  print -r -- "NOT USABLE YET: no profiles declared. Add them with set-profile."
  print -r -- "Also unset: lanes.base_branch (every worktree is cut from it).
  Detected candidate: $(print -r -- "$d" | jq -r '.suggested_base_branch')
  Confirm with the user, then: $0 set-lanes --base <branch>" ;;

validate)
  need
  local -a problems
  jq -e . "$CFG" >/dev/null 2>&1 || die "$CFG is not valid JSON"
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
  local fj; fj=$(print -r -- "$FLAGS" | tr ' ' '\n' | grep -v '^$' | jq -R . | jq -s . 2>/dev/null || print -r -- '[]')
  write "$(jq --arg n "$NAME" --arg k "$KIND" --arg m "$MODEL" --arg e "$EFFORT" --argjson f "$fj" \
    '.profiles[$n] = ({kind:$k, model:$m}
        + (if ($f|length)>0 then {flags:$f} else {} end)
        + (if $e != "" then {effort:$e} else {} end))
     | .default_profile = (.default_profile // $n)' "$CFG")"
  print -r -- "profile '$NAME' = $KIND / $MODEL${EFFORT:+ / effort=$EFFORT}${FLAGS:+ / $FLAGS}" ;;

set-lanes)
  need
  local MAX="" TO="" CTX="" BASE="" GATE=""
  while (( $# )); do
    case "$1" in
      --max) MAX="$2"; shift 2 ;; --timeout) TO="$2"; shift 2 ;; --context) CTX="$2"; shift 2 ;;
      --base) BASE="$2"; shift 2 ;; --gate-profile) GATE="$2"; shift 2 ;;
      *) die "unknown flag: $1" ;;
    esac
  done
  local j; j=$(cat -- "$CFG")
  [[ -n "$MAX" ]] && j=$(print -r -- "$j" | jq --argjson v "$MAX" '.lanes.max_concurrent=$v')
  # --timeout is herdr's agent-READINESS wait, not a lane runtime cap. herdr
  # refuses anything over 300000, and it refuses it at spawn time — which reads
  # as "the orchestrator is broken", not "the config is wrong". This config once
  # carried 1800000 (a runtime intent) and every lane start in a 72-hour run
  # died on invalid_agent_timeout. Refuse it here, where the mistake is made.
  if [[ -n "$TO" ]]; then
    [[ "$TO" == <-> ]] || die "--timeout takes milliseconds, got '$TO'"
    (( TO > 3000 && TO <= 300000 )) || die "--timeout $TO is outside herdr's range.
  This is how long 'agent start' waits for the harness to become READY
  (herdr: default 30000, max 300000) — not how long a lane may run.
  There is no lane runtime cap in this config; use the lane's own timeout."
    j=$(print -r -- "$j" | jq --argjson v "$TO" '.lanes.ready_timeout_ms=$v')
  fi
  [[ -n "$CTX" ]] && j=$(print -r -- "$j" | jq --argjson v "$CTX" '.lanes.context_cap_tokens=$v')
  if [[ -n "$BASE" ]]; then
    git -C "$REPO" rev-parse --verify -q "$BASE" >/dev/null 2>&1 \
      || die "base branch '$BASE' does not exist in $REPO.
  Every worktree is cut from it; a name that resolves nowhere fails at spawn,
  not here, and reads as a broken orchestrator."
    j=$(print -r -- "$j" | jq --arg v "$BASE" '.lanes.base_branch=$v')
  fi
  # The gate runs on a declared profile like everything else. It must be one the
  # project actually declares, or `orch-lane.sh gate` fails at spawn with a
  # profile lookup miss — which reads as a broken gate rather than a config gap,
  # and a gate that looks broken is a gate that gets skipped.
  if [[ -n "$GATE" ]]; then
    print -r -- "$j" | jq -e --arg p "$GATE" '.profiles[$p]' >/dev/null 2>&1 \
      || die "profile '$GATE' is not declared in this config.
  declared: $(print -r -- "$j" | jq -r '.profiles | keys | join(", ")')
  Add it with set-profile first — the gate reviews AND fixes, so give it a
  profile capable of both."
    j=$(print -r -- "$j" | jq --arg v "$GATE" '.lanes.gate_profile=$v')
  fi
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
  local j; j=$(cat -- "$CFG")
  [[ -n "$I"  ]] && j=$(print -r -- "$j" | jq --arg v "$I"  '.setup.install=$v')
  [[ -n "$B"  ]] && j=$(print -r -- "$j" | jq --arg v "$B"  '.setup.build=$v')
  [[ -n "$T"  ]] && j=$(print -r -- "$j" | jq --arg v "$T"  '.setup.test=$v')
  [[ -n "$BL" ]] && j=$(print -r -- "$j" | jq --arg v "$BL" '.setup.baseline=$v')
  write "$j"; jq -c '.setup' "$CFG" ;;

*) die "usage: orch-config.sh [path|show|detect|init|validate|set-profile|set-lanes|set-setup] [args] [repo]" ;;
esac

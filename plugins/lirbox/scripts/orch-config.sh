#!/bin/zsh
# Per-project orchestration config: where it lives, and how to make one.
#
#   orch-config.sh path [repo]   print the config path for a repo (default: cwd)
#   orch-config.sh show [repo]   print the config, or say it is absent
#   orch-config.sh init [repo]   write a template if none exists
#
# Stored user-local and keyed by the repo's git common dir, the same key the
# lane ledger uses — so one repo has one config no matter which worktree or
# subdirectory the orchestrator happens to be standing in.

emulate -L zsh
setopt no_nomatch

CMD="${1:-path}"
REPO="${2:-$PWD}"

# The git invocation here must match the one in hooks/*.sh. --path-format=absolute
# is load-bearing: without it git answers `.git` from a repo root and
# `../../.git` from a subdir, so unrelated repos collide and one repo splits.
KEY=$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[[ -n "$KEY" ]] || KEY="$REPO"

DIR="$HOME/.claude/lirbox-orchestrator"
CFG="$DIR/$(print -rn -- "$KEY" | shasum | cut -c1-12).json"

case "$CMD" in
  path) print -r -- "$CFG" ;;

  show)
    if [[ -r "$CFG" ]]; then
      print -r -- "# $CFG"
      cat -- "$CFG"
    else
      print -r -- "# no config for $REPO"
      print -r -- "# expected at: $CFG"
      print -r -- "# create one:  orch-config.sh init $REPO"
      exit 1
    fi
    ;;

  init)
    if [[ -e "$CFG" ]]; then
      print -u2 -r -- "refusing to overwrite $CFG"
      exit 1
    fi
    mkdir -p "$DIR"
    cat > "$CFG" <<'JSON'
{
  "version": 1,

  "_comment": "A lane's harness and model come from the bounded-context profile it is started with, never from a judgement made at spawn time. Add a profile here before using it; an unknown profile is refused.",

  "profiles": {
    "workspace-collab":     { "kind": "opencode", "model": "meta/muse-spark-1.2-contributor", "flags": ["--auto"] },
    "browser-e2e":          { "kind": "opencode", "model": "meta/muse-spark-1.2-contributor", "flags": ["--auto"] },
    "gadget-execution":     { "kind": "claude",   "model": "claude-opus-5" },
    "capability-brokerage": { "kind": "claude",   "model": "claude-opus-5" }
  },
  "default_profile": "workspace-collab",

  "lanes": {
    "max_concurrent": 4,
    "timeout_ms": 120000,
    "context_cap_tokens": 300000
  },

  "setup": {
    "_comment": "What a fresh worktree needs before its first suite run. A suite run before install is an ENVIRONMENT failure, not a defect.",
    "install": "pnpm install --frozen-lockfile",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "baseline": "state the expected pass/fail/skip counts here so a lane can tell a real red from an inherited one"
  }
}
JSON
    print -r -- "wrote $CFG"
    ;;

  *)
    print -u2 -r -- "usage: orch-config.sh [path|show|init] [repo]"
    exit 2
    ;;
esac

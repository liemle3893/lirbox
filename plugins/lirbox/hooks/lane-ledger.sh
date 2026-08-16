#!/bin/zsh
# PostToolUse(Bash) — record everything THIS orchestrator created.
#
# The ledger is the ownership boundary. A lane name, a pane, or a workspace is
# "ours" only if we watched the command that made it. Panes a human opened,
# panes another session opened, and panes in other workspaces are never written
# here, so no downstream hook can act on them.
#
# Recorded, one token per line:
#   * the NAME argument of `herdr agent start <name>`
#   * the --pane ID that start was given
#   * every pane_id / workspace_id that `worktree create` or `pane split`
#     printed back, since those are panes we just brought into existence
#
# Keyed by git common dir so a replacement orchestrator picks up the same
# ledger, every worktree of one repo shares it, and no other repo can.

emulate -L zsh
setopt no_nomatch

IN=$(cat)
[[ "$(print -r -- "$IN" | jq -r '.agent_type // ""')" == "lirbox:lirbox-herdr-orchestrator" ]] || exit 0

CMD=$(print -r -- "$IN" | jq -r '.tool_input.command // ""')
[[ "$CMD" == *herdr* ]] || exit 0

CWD=$(print -r -- "$IN" | jq -r '.cwd // ""')
# --path-format=absolute is load-bearing: without it git answers `.git` from a
# repo root, `../../.git` from a subdir, and an absolute path from a worktree.
# Every repo root would share one ledger, and one repo would split across three.
# This line must stay byte-identical to the one in lane-gate.sh.
KEY=$(git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[[ -n "$KEY" ]] || KEY="$CWD"

LEDGER_DIR="$HOME/.claude/lirbox-lanes"
mkdir -p "$LEDGER_DIR"
LEDGER="$LEDGER_DIR/$(print -rn -- "$KEY" | shasum | cut -c1-12).tsv"

add() {
  local tok="$1"
  [[ -n "$tok" && "$tok" != -* ]] || return 0
  grep -qxF "$tok" "$LEDGER" 2>/dev/null || print -r -- "$tok" >> "$LEDGER"
}

# `herdr agent start <name> --kind ... --pane <id>`
if [[ "$CMD" == *agent*start* ]]; then
  add "$(print -r -- "$CMD" | sed -n 's/.*herdr[[:space:]]\{1,\}agent[[:space:]]\{1,\}start[[:space:]]\{1,\}\([^[:space:]]\{1,\}\).*/\1/p' | head -1)"
  add "$(print -r -- "$CMD" | sed -n 's/.*--pane[[:space:]]\{1,\}\([^[:space:]]\{1,\}\).*/\1/p' | head -1)"
fi

# Panes and workspaces we just created — read them out of what herdr printed.
if [[ "$CMD" == *worktree*create* || "$CMD" == *pane*split* ]]; then
  OUT=$(print -r -- "$IN" | jq -r '.tool_response.stdout // ""')
  for tok in ${(f)"$(print -r -- "$OUT" | grep -oE '"(pane_id|workspace_id)":"[^"]+"' | sed 's/.*:"//;s/"$//' | sort -u)"}; do
    add "$tok"
  done
fi

exit 0

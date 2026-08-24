#!/bin/zsh
# The harness table. Sourced by scripts/orch-lane.sh,
# skills/lane-config/scripts/orch-config.sh and hooks/model-policy.sh.
#
# Before this file, "which flag carries the bounded-context profile" was the
# literal string `--agent` written into orch-lane.sh's arg vector, and "which
# harnesses exist" was the pattern `(claude|opencode)` repeated in three files.
# That is correct for exactly two harnesses and wrong for the third: omp carries
# its profile as `--append-system-prompt <file>` and its effort as `--thinking`,
# so a hardcoded `--agent` would have emitted a flag omp does not have — and a
# TUI that ignores unknown flags reports success while running with no
# invariants at all. That failure is invisible for hours; it is the same one
# `/clear` causes, and the reason `restart` exists.
#
# Adding a harness is this table plus nothing. If you find yourself writing
# `[[ $KIND == omp ]]` somewhere else, the field you need is missing here.
#
# HK_AGENT_ARG says how the profile reaches the harness:
#   name  the profile name is the flag's value          (claude, opencode)
#   file  the flag takes a PATH to the agent markdown   (omp)
#   none  the harness has no profile flag at all        (jcode)
# `none` is not "no invariants" — it means the profile cannot ride the command
# line, so a lane on that harness needs its context in the checkout (AGENTS.md).
# Nothing starts a `none` lane today; jcode is here because herdr cannot start
# it either, and the refusal below should name the reason rather than surface a
# clap error about an enum.

# No `emulate`/`setopt` here on purpose: this file is SOURCED, and emulate
# resets options the caller already set — orch-lane.sh turns on pipefail one
# line above the source. Every caller sets `emulate -L zsh; setopt no_nomatch`
# for itself before sourcing.

typeset -gA HK_AGENT_FLAG HK_AGENT_ARG HK_MODEL_FLAG HK_EFFORT_FLAG HK_EFFORT_VALUES

# --agent <name>: the harness resolves the name against its own agent registry.
HK_AGENT_FLAG=(
  claude   '--agent'
  opencode '--agent'
  omp      '--append-system-prompt'
  jcode    ''
)
HK_AGENT_ARG=(
  claude   name
  opencode name
  omp      file
  jcode    none
)
HK_MODEL_FLAG=(
  claude   '--model'
  opencode '--model'
  omp      '--model'
  jcode    '-m'
)
# Reasoning effort. opencode's INTERACTIVE entry — the one herdr starts — has
# none: --variant belongs to `opencode run`, and the tui ignores unknown flags
# silently, so emitting one would do nothing and look like it worked. jcode's
# top-level entry has no effort flag either.
HK_EFFORT_FLAG=(
  claude   '--effort'
  opencode ''
  omp      '--thinking'
  jcode    ''
)
# Accepted values, where they are known. An EMPTY entry means "this harness
# takes effort but its vocabulary is not known here" — accept what the user
# declares rather than invent a whitelist that refuses a valid level. A
# whitelist guessed wrong fails at spawn, which is the failure mode this whole
# file exists to remove.
HK_EFFORT_VALUES=(
  claude 'low medium high xhigh max'
  omp    ''
)

hk_kinds() { print -r -- "${(ko)HK_AGENT_ARG}" }
hk_known() { [[ -n "${HK_AGENT_ARG[$1]-}" ]] }

# Whether herdr can START this kind, as opposed to whether lirbox knows its
# flags. The two are different questions and jcode is the case that separates
# them: lirbox knows jcode's flags, and `herdr agent start --kind jcode` answers
# "unsupported interactive agent kind".
#
# This is a static field rather than a probe of herdr because the ONLY place
# herdr prints its enum is `herdr agent start --help` — a command indistinguish-
# able from a spawn to anything watching herdr calls, which is most of this
# plugin: pane-guard.sh denies raw `agent start`, and the spawn-door check reads
# any `agent start` as a spawn and failed on exactly that. A probe on the normal
# path would be a fake spawn in every healthy run.
#
# Staleness is handled below by probing ONLY to widen: a `no` is re-checked
# against the live herdr before it refuses, so the day herdr adds a harness it
# starts working without an edit here. A `yes` never probes at all.
typeset -gA HK_HERDR
HK_HERDR=(
  claude   yes
  opencode yes
  omp      yes
  jcode    no
)

hk_herdr_kinds() {
  HERDR_ENV=1 herdr agent start --help 2>&1 \
    | sed -n 's/.*\[possible values: \(.*\)\].*/\1/p' \
    | tr -d ' ' | tr ',' '\n' | grep -v '^$'
}

hk_herdr_supports() {
  [[ "${HK_HERDR[$1]-}" == yes ]] && return 0
  # Only reached for a kind the table says herdr cannot start — the path that
  # would otherwise be a flat refusal, so one --help here costs nothing and
  # cannot be mistaken for a spawn in a run that is working.
  local -a avail
  avail=(${(f)"$(hk_herdr_kinds)"})
  (( $#avail )) || return 1          # cannot confirm; the table's `no` stands
  (( avail[(Ie)$1] ))
}

# Where an agent markdown lives, for the harnesses that take a path instead of a
# name. Repo first: a project that ships its own `.claude/agents/<p>.md` means
# that one, not the plugin's copy of the same name.
hk_agent_file() {
  local agent="$1" root="${2:-$PWD}" c
  for c in "$root/.claude/agents/$agent.md" \
           "${CLAUDE_PLUGIN_ROOT:-${0:h:h}}/agents/$agent.md" \
           "${CLAUDE_PLUGIN_ROOT:-${0:h:h}}/agents/lirbox-$agent.md" \
           "$HOME/.claude/agents/$agent.md"; do
    [[ -r "$c" ]] && { print -r -- "$c"; return 0 }
  done
  return 1
}

# The argument vector that goes after `--` on `herdr agent start`. Prints one
# argument per line: a model id or a path may contain spaces, and the callers
# that used ${=FLAGS} to split on them are the reason this returns a real list.
# $2 is the AGENT id, not the profile name. They are equal by default and a
# profile may override it: a repo's own agent rarely shares a name with the role
# it plays in a run, and forcing the two to match would mean either renaming the
# agent or naming the lane after a file.
hk_launch_args() {
  local kind="$1" agent="$2" model="$3" effort="$4" flags="$5" root="${6:-$PWD}"
  local -a out
  local af="${HK_AGENT_FLAG[$kind]-}" aa="${HK_AGENT_ARG[$kind]-}"
  local mf="${HK_MODEL_FLAG[$kind]-}" ef="${HK_EFFORT_FLAG[$kind]-}"

  case "$aa" in
    name) out+=("$af" "$agent") ;;
    file)
      local p
      p=$(hk_agent_file "$agent" "$root") || {
        print -u2 -r -- "no agent markdown for '$agent'.
  $kind carries its bounded context as a FILE ($af), not a name, so it must
  exist as markdown. Looked in:
    $root/.claude/agents/$agent.md
    \${CLAUDE_PLUGIN_ROOT}/agents/$agent.md
    \${CLAUDE_PLUGIN_ROOT}/agents/lirbox-$agent.md
    \$HOME/.claude/agents/$agent.md"
        return 1
      }
      out+=("$af" "$p") ;;
    none) : ;;
    *) print -u2 -r -- "unknown harness kind '$kind'"; return 1 ;;
  esac

  [[ -n "$model"  && -n "$mf" ]] && out+=("$mf" "$model")
  [[ -n "$effort" && -n "$ef" ]] && out+=("$ef" "$effort")
  [[ -n "$flags" ]] && out+=(${=flags})
  print -rl -- "${out[@]}"
}

#!/bin/bash
# Refresh the DERIVED part of a Harbor task tree. Run before `harbor run -p .harbor/tasks/<id>`.
#
# Everything else under .harbor/ is now TRACKED — task.toml, instruction.md, tests/, solution/ and
# environment/Dockerfile all live in git, because that is the layout `harbor run -p` consumes and
# nothing regenerates it since harbor-build.mjs was dropped in PR #46.
#
# The ONE exception is environment/skill/: a verbatim copy of plugins/lirbox/skills/<skill>/, baked
# into the image so the sandbox can resolve the skill under test by its bare name. Committing it
# would duplicate the skill (~216 files) and let the copy drift from the real one — the same trap
# CLAUDE.md flags for copied validators. So it is gitignored and this script re-creates it.
#
# This is deliberately NOT a revival of harbor-build.mjs: that compiled whole tasks from the
# source-side declaration. This only refreshes the derived skill copy.
#
# Prunes evals/, harbor/ and arena/ from the copy — CLAUDE.md: never hand a container the graders it
# is scored against.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd)

status=0
for taskdir in .harbor/tasks/*/; do
  [ -d "$taskdir" ] || continue
  id=$(basename "$taskdir")
  skill=${id%%__*}                      # "conductor__scaffold-multiphase" -> "conductor"
  src="plugins/lirbox/skills/$skill"
  dest="$taskdir/environment/skill"

  if [ ! -d "$src" ]; then
    echo "SKIP $id — no such skill at $src" >&2
    status=1
    continue
  fi

  /bin/rm -rf "$dest" 2>/dev/null
  mkdir -p "$dest"
  # -R over the contents so hidden files come along; then prune the eval material.
  cp -R "$src/." "$dest/" || { echo "FAIL $id — copy failed" >&2; status=1; continue; }
  for pruned in evals harbor arena; do
    /bin/rm -rf "$dest/$pruned" 2>/dev/null
  done

  n=$(find "$dest" -type f | wc -l | tr -d ' ')
  leaked=$(find "$dest" -type d \( -name evals -o -name harbor -o -name arena \) | wc -l | tr -d ' ')
  if [ "$leaked" != "0" ]; then
    echo "FAIL $id — eval material survived the prune" >&2
    status=1
    continue
  fi
  echo "OK   $id — vendored $skill ($n files) to $dest"
done

exit $status

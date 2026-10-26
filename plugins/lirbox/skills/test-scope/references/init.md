# test-scope init — set selection up once per repo

Run from SKILL.md's `<init>`. Commands are `node $TS <verb>` as listed in SKILL.md's `<scripts>`.

1. `detect`; plan the metrics first (measure). Note every package, runner, wrapper
   (lock/nice script, CI matrix) and the suite's size; time the full suite only if CI or logs
   do not already say.
2. Draft parts from the **test tree** (test folders/names cluster into domains) and map **source
   dirs** onto them. Then walk `references/hidden-links.md` against this repo, grepping for each
   link class; each confirmed link becomes a `paths` glob with the evidence in a `_comment`.
3. Present the part table (part → tests → source globs → checks) and the run-everything list.
   Wait for approval; adjust granularity as the user asks.
4. Write `parts.json`; run `coverage` until every test file is owned and no glob is dead.
5. `measure --commits 20 --label baseline`: median/max files selected vs. full. A commit that
   selects nearly everything names a trigger or hub that is too broad — `hubs`, fix it now.
6. Wire it in: a package script (`test:run`), the repo's agent/contributor docs (implementer runs
   `select --changed` once; reviewer adds parts on evidence; full suite = backstop), CI if any
   (select on PR, full on schedule). With OCR: `rules --write` and the reviewer uses delegate mode
   (`ocr delegate preview` → `ocr delegate rule <files>`) with the user's chosen model.
7. Acceptance: on a real recent commit, `select --list` matches what a careful human would run,
   one `run` is green, `doctor --changed` is clean; `measure --compare baseline <label>` gives the lift.

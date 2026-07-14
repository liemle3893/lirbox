# uglify-js-3.17.4 fixture — re-derivation recipe

Unlike the notes-app fixtures, this fixture's source tree is NOT committed here (it is a
5.1 MB vendored copy of a real upstream repo). The committed artifact is the task's
`repo.bundle`; this recipe regenerates the identical tree/bundle if it is ever lost.

The fixture is **upstream UglifyJS at tag `v3.17.4`** plus:

1. vendored dev dependencies `node_modules/acorn` (8.7.1, exact) and
   `node_modules/semver` (6.3.0, exact) — the only external requires of `npm test` —
   so the suite runs hermetically with no install step;
2. `.gitignore` with the `node_modules` line removed (so `make-fixture` can commit
   the vendored deps).

```sh
git clone https://github.com/mishoo/UglifyJS.git /tmp/uglify-upstream
mkdir /tmp/fixture-src
git -C /tmp/uglify-upstream archive v3.17.4 | tar -x -C /tmp/fixture-src
cd /tmp/fixture-src
npm install --no-save --no-audit --no-fund acorn@8.7.1 semver@6.3.0
/bin/rm -rf node_modules/.bin node_modules/.package-lock.json package-lock.json
grep -v 'node_modules' .gitignore > .gitignore.tmp && mv .gitignore.tmp .gitignore   # the line is "/node_modules/"
node <lirbox>/plugins/lirbox/skills/arena/scripts/make-fixture.cjs \
  --task uglify-corner-cases --dir /tmp/fixture-build \
  --fixture uglify-js-3.17.4 --src /tmp/fixture-src
```

The commit message is pinned in `make-fixture.cjs` (`COMMIT_MSG['uglify-js-3.17.4']`);
with the fixed author/date env in that script the bundle sha is deterministic:
`e7caa58a08915cafea060ef955d90a663e570a20`.

## Task provenance (uglify-corner-cases)

The task's six bugs are REAL upstream miscompilations, all present at v3.17.4 and fixed
upstream by these commits (gold solution = the six `lib/` patches applied jointly; they
apply cleanly and independently onto v3.17.4):

| Report | upstream issue | fix commit | transform |
|---|---|---|---|
| 1 | #5854 | 8195a664 | collapse_vars |
| 2 | #5863 | 6669ea19 | hoist_vars |
| 3 | #5882 | b6b0658f | dead_code |
| 4 | #5917 | f34fbb2c | reduce_vars |
| 5 | #5930 | b54f298c | merge_vars |
| 6 | #5940 | 5c3927c4 | evaluate |

Selection method: scanned every `fix corner case` commit after v3.17.4, extracted the
regression tests each one added, and kept only cases whose compressed output is
**behaviorally divergent** at v3.17.4 (same-stdout/termination probe — form-only
divergences were excluded to keep the graders fair: they assert only the behavior
equality that task.md states). Issue numbers are deliberately omitted from task.md so
the upstream fixes can't be looked up trivially; they are recorded here for maintainers.

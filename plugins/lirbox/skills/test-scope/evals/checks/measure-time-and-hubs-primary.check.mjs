#!/usr/bin/env node
// Frozen check: `measure --compare` judges a change by measured selected-run TIME and by tests reached
// ONLY through a hub, and never calls a file-count percentile regression "worse".
// Observed 2026-10-06: removing two composition roots and four barrels halved the targeted commits'
// selections, yet the replay p90 of selected file counts did not move (175 -> 176): it was set by an
// honestly broad 26-file feature commit. A p90-of-file-count verdict punishes honest breadth.
//
// Scenario (python graph, stdlib only): BEFORE, app.py is a composition root that test_app reaches
// dom_a through (1 test only-via the hub), runs log 10/20/30 s. AFTER, the root is gone (test_app
// imports the domains it uses) and the measured commit is broader (edits both domains: 2 -> 3 files
// selected), runs log 5/8/9 s plus one failed run. Invariant:
//   - records carry runSeconds {median, p90} from --runs (failed runs excluded) and hubOnlyVia (1 -> 0)
//   - compare rows rank runSeconds.median, runSeconds.p90, hubOnlyVia first, as tier "primary"
//   - selection.p90 2 -> 3 is reported with verdict "info", never "worse"; the summary has worse 0
//
// Exit 0 = invariant holds, 1 = violated, 2 = harness could not run.
// TEST_SCOPE_OVERRIDE: any file in the scripts dir under test (set by prove-checks); test-scope.mjs beside it runs.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = process.env.TEST_SCOPE_OVERRIDE ? path.dirname(process.env.TEST_SCOPE_OVERRIDE) : path.join(here, '..', '..', 'scripts');
const SCRIPT = path.join(SCRIPTS, 'test-scope.mjs');
if (spawnSync('python3', ['--version']).status !== 0) { console.error('harness: python3 not installed'); process.exit(2); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-measure-primary-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (files) => {
  for (const [rel, c] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof c === 'string' ? c : JSON.stringify(c, null, 2));
  }
  git('add', '-A');
  git('-c', 'user.name=fx', '-c', 'user.email=fx@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'c');
};
const ts = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
const jsonl = (xs) => xs.map((x) => JSON.stringify(x)).join('\n') + '\n';

let bad = 0;
const expect = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

git('init', '-q', '-b', 'main');
commit({
  'dom_a.py': 'A = 1\n', 'dom_b.py': 'B = 1\n', 'app.py': 'import dom_a\nimport dom_b\n',
  'tests/test_app.py': 'import app\n', 'tests/test_a.py': 'import dom_a\n', 'tests/test_b.py': 'import dom_b\n',
  '.test-scope/parts.json': { packages: { py: { dir: '.', runner: 'pytest' } }, noTests: ['.test-scope/**', 'runs-*.jsonl'], parts: {}, graphOnly: { py: ['tests/**'] } },
  'runs-before.jsonl': jsonl([10, 20, 30].map((s, i) => ({ at: `2026-10-0${i + 1}`, sha: 'b', seconds: s, files: 2, ok: true }))),
  'runs-after.jsonl': jsonl([...[5, 8, 9].map((s) => ({ at: '2026-10-06', sha: 'a', seconds: s, files: 3, ok: true })), { at: '2026-10-06', sha: 'a', seconds: 1, files: 3, ok: false }]),
});
commit({ 'dom_a.py': 'A = 2\n' }); // selects test_a + test_app (via app.py only)
const before = ts(['measure', '--commits', '1', '--resolve', '--runs', 'runs-before.jsonl', '--label', 'before']);
expect(before.status === 0, `measure before exits 0 (got ${before.status}: ${before.stderr.trim().split('\n')[0] || ''})`);

// refactor: drop the composition root; test_app mounts only what it uses. Then an honestly broad commit.
commit({ 'tests/test_app.py': 'import dom_a\nimport dom_b\n', 'app.py': '' });
commit({ 'dom_a.py': 'A = 3\n', 'dom_b.py': 'B = 3\n' }); // selects test_a, test_b, test_app: 3 files
const after = ts(['measure', '--commits', '1', '--resolve', '--runs', 'runs-after.jsonl', '--label', 'after']);
expect(after.status === 0, `measure after exits 0 (got ${after.status}: ${after.stderr.trim().split('\n')[0] || ''})`);

let recs = [];
try { recs = fs.readFileSync(path.join(dir, '.test-scope/metrics.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* none written */ }
const [rb, ra] = [recs.find((r) => r.label === 'before'), recs.find((r) => r.label === 'after')];
expect(rb?.runSeconds?.median === 20 && rb?.runSeconds?.p90 === 30, `before runSeconds median 20, p90 30 (got ${JSON.stringify(rb?.runSeconds ?? null)})`);
expect(ra?.runSeconds?.median === 8 && ra?.runSeconds?.p90 === 9, `after runSeconds median 8, p90 9, failed run excluded (got ${JSON.stringify(ra?.runSeconds ?? null)})`);
expect(rb?.hubOnlyVia === 1, `before hubOnlyVia 1: test_app reaches dom_a only via app.py (got ${rb?.hubOnlyVia})`);
expect(ra?.hubOnlyVia === 0, `after hubOnlyVia 0 (got ${ra?.hubOnlyVia})`);
expect(rb?.selection?.p90 === 2 && ra?.selection?.p90 === 3, `fixture sanity: file-count p90 rises 2 -> 3 (got ${rb?.selection?.p90} -> ${ra?.selection?.p90})`);

const cj = ts(['measure', '--compare', 'before', 'after', '--json']);
let cmp = null;
try { cmp = JSON.parse(cj.stdout); } catch { /* reported below */ }
expect(!!cmp?.rows, `compare --json gives rows (exit ${cj.status})`);
const rows = cmp?.rows || [];
const firstThree = rows.slice(0, 3).map((x) => x.key);
expect(JSON.stringify(firstThree) === JSON.stringify(['runSeconds.median', 'runSeconds.p90', 'hubOnlyVia']), `rows ranked time + hub first (got ${firstThree.join(', ')})`);
expect(rows.slice(0, 3).every((x) => x.tier === 'primary' && x.verdict === 'better'), `those three are tier primary and better (got ${rows.slice(0, 3).map((x) => `${x.tier}/${x.verdict}`).join(', ')})`);
const p90 = rows.find((x) => x.key === 'selection.p90');
expect(p90 && p90.a === 2 && p90.b === 3 && p90.verdict === 'info', `selection.p90 2 -> 3 is informational, not a regression (got ${p90 ? `${p90.a} -> ${p90.b} ${p90.verdict}` : 'missing'})`);
expect(!rows.some((x) => x.key.startsWith('selection.') && x.verdict === 'worse'), 'no file-count row is judged worse');

const ct = ts(['measure', '--compare', 'before', 'after']);
const out = ct.stdout;
const iTime = out.indexOf('selected run time median'), iFiles = out.indexOf('selection p90 (files)');
expect(iTime >= 0 && iFiles > iTime, 'human output prints run time before file counts');
expect(/^better \d+, worse 0, same \d+/m.test(out), `summary counts no regression (got "${(out.match(/^better .*$/m) || ['none'])[0]}")`);

if (bad) { console.error(`\n${bad} assertion(s) violate: time and hub-only tests are the primary verdict; file-count percentiles are informational`); process.exit(1); }
console.log('\nall assertions hold');

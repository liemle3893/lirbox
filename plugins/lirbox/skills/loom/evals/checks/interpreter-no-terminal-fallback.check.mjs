// CHECK — the emitted interpreter must HARD-FAIL on an unmatched result, never route to
// the terminal. `edge ? edge.to : graph.terminal` skipped every remaining gate on any
// off-shape agent result: 6 of 8 plausible shapes reached the terminal, no patch needed.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');
// Mutation hatch for scripts/prove-checks.mjs: it copies the skill tree, mutates ONE
// file in the copy, and points this variable at it. Without a hatch a check cannot be
// mutation-proven, and an unproven check is not known to be measuring anything.
const coreFile = process.env.LOOM_GRAPH_CORE_OVERRIDE
  || join(SCRIPTS, 'graph-core.mjs');
const core = await import(pathToFileURL(coreFile).href);

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

// 1. The generated conductor must not contain the fallback, and must contain the throw.
const g = {
  name: 'c', goal: 'c', start: 'S', terminal: 'D',
  nodes: [{ id: 'S', kind: 'work', prompt: 'go' },
          { id: 'G', kind: 'gate', locked: true, prompt: 'judge' }, { id: 'D', kind: 'terminal' }],
  edges: [{ from: 'S', to: 'G', when: 'always' },
          { from: 'G', to: 'D', when: { field: 'passed', eq: true }, locked: true },
          { from: 'G', to: 'S', when: { field: 'passed', eq: false }, locked: true }],
  invariants: { mustCross: ['G'], visitCaps: { '*': 3 }, nodeBudget: 20 },
};
g.invariants.lockedHash = core.lockedFingerprint(g);
const tmp = mkdtempSync(join(tmpdir(), 'loom-check-'));
const gf = join(tmp, 'g.json'), out = join(tmp, 'c.js');
writeFileSync(gf, JSON.stringify(g));
execFileSync('node', [process.env.LOOM_SCAFFOLD_OVERRIDE || join(SCRIPTS, 'scaffold-loom.cjs'), '--name', 'c',
  '--graph', gf, '--out', out, '--force'], { stdio: 'pipe' });
const src = readFileSync(out, 'utf8');
// POSITIVE STRUCTURAL assertions, not greps. A NEGATIVE grep forbids only the one
// spelling someone thought to write down: `edge?.to ?? graph.terminal` reintroduces the
// Critical and sails past it. And matching 'no edge matched at' anywhere in the file is
// satisfied by a COMMENT — it never establishes that a throw is on the code path.
// Verified: with the old pair, deleting the throw and writing the fallback in new syntax
// left this check GREEN.
ok(/if \(!edge\) \{[\s\S]{0,600}?throw new Error\(\s*'no edge matched at/.test(src),
  'the unmatched-result throw is on the code path, not just a string in the file');
ok(/const nextNode = edge\.to\b/.test(src),
  'nextNode is assigned unconditionally from the matched edge — no fallback expression');

// 2. The behaviour: off-shape results must match NO edge, so the interpreter throws.
const P = {
  start: 'Setup', terminal: 'PR',
  nodes: [{ id: 'Setup' }, { id: 'GateA' }, { id: 'GateB' }, { id: 'PR' }],
  edges: [
    { from: 'Setup', to: 'GateA', when: 'always' },
    { from: 'GateA', to: 'GateB', when: { field: 'passed', eq: true } },
    { from: 'GateA', to: 'Setup', when: { field: 'passed', eq: false } },
    { from: 'GateB', to: 'PR', when: { field: 'passed', eq: true } },
    { from: 'GateB', to: 'Setup', when: { field: 'passed', eq: false } },
  ],
};
for (const r of [{ passed: 'true' }, { passed: 1 }, {}, { verdict: true }, null, { ok: true }]) {
  ok(core.pickEdge(P, 'GateA', r) === null, `off-shape result matches no edge: ${JSON.stringify(r)}`);
}
ok(core.pickEdge(P, 'GateA', { passed: true }).to === 'GateB', 'well-formed pass still routes');
ok(core.pickEdge(P, 'GateA', { passed: false }).to === 'Setup', 'well-formed fail still routes');

// 3. Dead ends are rejected at validation, before a run can start.
const dead = core.applyPatchTo(g, { addNodes: [{ id: 'Dead' }],
  addEdges: [{ from: 'S', to: 'Dead', when: { field: 'q', eq: 1 } }] });
ok(core.messages(core.validateGraph(dead, g, null)).some((m) => /dead-end/.test(m)), 'dead-end node rejected');

if (bad) { console.error(`\ninterpreter-no-terminal-fallback: ${bad} failed`); process.exit(1); }
console.log('interpreter-no-terminal-fallback: ok');

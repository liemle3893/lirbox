// CHECK — only a gate's LOCKED PASSING edge may lead onward. Dominance proves a gate is
// VISITED, not that it PASSED: `DoDGate --fail--> Done` left the gate on every path and
// still ended the run with it unsatisfied. In lite, pickEdge returned the SAME
// destination for {passed:true} and {passed:false} — the verdict was inert.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

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

for (const profile of ['lite', 'delivery']) {
  const seed = JSON.parse(readFileSync((process.env.LOOM_SEED_OVERRIDE && process.env.LOOM_SEED_OVERRIDE.endsWith(`${profile}.json`)
      ? process.env.LOOM_SEED_OVERRIDE : join(SCRIPTS, 'seeds', `${profile}.json`)), 'utf8'));
  const gate = seed.invariants.mustCross[seed.invariants.mustCross.length - 1];
  const fail = seed.edges.find((e) => e.from === gate && e.when && e.when.eq === false);

  ok(core.validateGraph(seed, seed, null).length === 0, `${profile}: baseline validates`);

  // Every shape that lets a not-passing gate lead onward must be rejected.
  const reroute = core.applyPatchTo(seed, {
    removeEdges: [{ from: gate, to: fail.to }],
    addEdges: [{ from: gate, to: seed.terminal, when: fail.when }] });
  ok(core.validateGraph(reroute, seed, null).length > 0, `${profile}: failure edge -> terminal rejected`);

  const always = core.applyPatchTo(seed, {
    addEdges: [{ from: gate, to: seed.terminal, when: 'always' }] });
  ok(core.validateGraph(always, seed, null).length > 0, `${profile}: appended always-edge rejected`);

  for (const field of ['passed', 'anythingAtAll']) {
    const mint = core.applyPatchTo(seed, {
      addEdges: [{ from: gate, to: seed.terminal, when: { field, eq: true } }] });
    ok(core.validateGraph(mint, seed, null).length > 0,
      `${profile}: minted pass edge on '${field}' rejected`);
  }

  // ...and legitimate reshaping of the failure path must still be accepted AND reachable.
  const spliced = core.applyPatchTo(seed, {
    removeEdges: [{ from: gate, to: fail.to }],
    addNodes: [{ id: 'Spike', kind: 'work' }],
    addEdges: [{ from: gate, to: 'Spike', when: { field: 'passed', eq: false } },
               { from: 'Spike', to: fail.to, when: 'always' }] });
  ok(core.validateGraph(spliced, seed, null).length === 0, `${profile}: spike splice accepted`);
  ok((core.pickEdge(spliced, gate, { passed: false }) || {}).to === 'Spike',
    `${profile}: spliced node is REACHABLE, not shadowed`);
}

if (bad) { console.error(`\ngate-failure-edges-return: ${bad} failed`); process.exit(1); }
console.log('gate-failure-edges-return: ok');

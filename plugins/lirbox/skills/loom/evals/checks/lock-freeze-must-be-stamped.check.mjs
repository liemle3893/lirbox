// CHECK — a gate lock nothing stamped is not a lock. Without invariants.lockedHash the
// exempt-locked-edge rule (`e.locked && e.when.eq === true`) has nothing behind it: a patch
// can simply MINT `locked: true` on a new edge straight from a gate to the terminal, and
// nothing rejects it. Measured on delivery.json: an unstamped prev plus a minted locked
// edge validated clean and the run reached the terminal with DoDGate's last verdict false.
// The freeze was enforced by prose in SKILL.md step 3 and by nothing in code.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');
const core = await import(join(SCRIPTS, 'graph-core.mjs'));

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

for (const profile of ['lite', 'delivery']) {
  const seed = JSON.parse(readFileSync(join(SCRIPTS, 'seeds', `${profile}.json`), 'utf8'));
  const gate = seed.invariants.mustCross[seed.invariants.mustCross.length - 1];

  // 1. Pre-approval seeding — prev is null, the graph has not been frozen yet. The stamp
  // requirement must NOT fire here, or a run could never start.
  ok(core.validateGraph(seed, null, null).length === 0, `${profile}: pre-approval seeding unaffected`);

  // 2. The approved graph validates against itself.
  ok(core.validateGraph(seed, seed, null).length === 0, `${profile}: approved vs itself unaffected`);

  // 3. Legitimate in-run patching against a properly stamped prev.
  const spliced = core.applyPatchTo(seed, {
    addNodes: [{ id: 'Spike', kind: 'work' }],
    addEdges: [{ from: seed.start, to: 'Spike', when: 'always' },
               { from: 'Spike', to: seed.start, when: 'always' }] });
  ok(core.validateGraph(spliced, seed, null).length === 0, `${profile}: legit in-run patch vs stamped prev unaffected`);

  // 4. An UNSTAMPED prev, with NO other tampering, must be rejected on its own — this is
  // the part that proves the STAMP itself is required, not merely a side effect of some
  // other rule catching a bypass built on top of it.
  const unstamped = JSON.parse(JSON.stringify(seed));
  delete unstamped.invariants.lockedHash;
  const vBare = core.validateGraph(unstamped, unstamped, null);
  ok(vBare.some((m) => /lockedHash was never stamped/.test(m)),
    `${profile}: an unstamped prev is rejected even with no other tampering`);

  // 5. The real attack: unstamped prev PLUS a minted locked:true edge straight to the
  // terminal. Must be rejected, and specifically for the missing stamp, not just for
  // some other reason that happens to also fire.
  const bypass = JSON.parse(JSON.stringify(unstamped));
  bypass.edges.push({ from: gate, to: seed.terminal, when: 'always', locked: true });
  const vBypass = core.validateGraph(bypass, unstamped, null);
  ok(vBypass.length > 0, `${profile}: unstamped prev + minted locked edge is REJECTED`);
  ok(vBypass.some((m) => /lockedHash was never stamped/.test(m)),
    `${profile}: rejection specifically names the missing stamp`);
  ok(core.reachable(bypass, bypass.start, []).has(bypass.terminal),
    `${profile}: fixture is only meaningful if the minted edge really reaches the terminal`);

  // 6. Control: a graph with no mustCross gates at all, and no stamp, must NOT trigger
  // this rule — it is scoped to graphs that declare gates, not to every unstamped graph.
  const noGates = JSON.parse(JSON.stringify(seed));
  noGates.invariants.mustCross = [];
  delete noGates.invariants.lockedHash;
  ok(!core.validateGraph(noGates, noGates, null).some((m) => /lockedHash was never stamped/.test(m)),
    `${profile}: a graph declaring no gates is not required to carry a stamp`);
}

if (bad) { console.error(`\nlock-freeze-must-be-stamped: ${bad} failed`); process.exit(1); }
console.log('lock-freeze-must-be-stamped: ok');

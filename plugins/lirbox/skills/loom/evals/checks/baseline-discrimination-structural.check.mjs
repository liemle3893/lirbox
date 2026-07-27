// CHECK — DoDBaseline's "a non-discriminating baseline stops the run" must be enforced by the
// GRAPH, not by prompt prose. Its out-edge was once when:"always", so a worker honestly
// reporting discriminates:false routed onward and the run continued. Worse than enforced by
// prose — enforced by nothing.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');
const core = await import(join(SCRIPTS, 'graph-core.mjs'));
const seed = JSON.parse(readFileSync(join(SCRIPTS, 'seeds', 'delivery.json'), 'utf8'));

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

const out = seed.edges.filter((e) => e.from === 'DoDBaseline');
ok(out.length === 1, 'DoDBaseline has exactly one out-edge');
ok(out[0].when && out[0].when.field === 'discriminates' && out[0].when.eq === true,
  'that edge requires discriminates === true');

ok((core.pickEdge(seed, 'DoDBaseline', { discriminates: true }) || {}).to === 'Plan',
  'a discriminating baseline advances');
for (const r of [{ discriminates: false }, { baselines: [] }, { discriminates: 1 },
                 { discriminates: 'true' }, null]) {
  ok(core.pickEdge(seed, 'DoDBaseline', r) === null,
    `no edge matches ${JSON.stringify(r)} — interpreter hard-fails`);
}

// The tamper signal must stay reportable and distinct from an ordinary failure.
const gate = seed.nodes.find((n) => n.id === 'DoDGate');
ok(gate.schema.properties.criteria.items.properties.verdict.enum.includes('TAMPERED'),
  'DoDGate can report TAMPERED distinctly from UNMET');

if (bad) { console.error(`\nbaseline-discrimination-structural: ${bad} failed`); process.exit(1); }
console.log('baseline-discrimination-structural: ok');

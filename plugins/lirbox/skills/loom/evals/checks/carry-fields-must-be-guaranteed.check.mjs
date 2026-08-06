// CHECK — every field named in an edge's `carry` must be REQUIRED by the source node's schema.
// The carry is the only channel a graph has for turning a gate failure into actionable input
// for the node it re-enters. All three carries in the shipped seeds named OPTIONAL fields:
// Review --carry:["findings"]--> Implement with required ["passed","buildExit"], and
// DoDGate --carry:["unmetCriteria"]--> Implement with required ["passed","criteria"]. A worker
// that omits an optional field is schema-valid, so a failing gate could legally re-enter
// Implement carrying NOTHING — and the re-entered node would rediscover the failure blind,
// burning its visit cap instead of converging. Convergence in the one observed back-edge run
// depended entirely on the reviewer volunteering a field it was never obliged to send.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDS = resolve(HERE, '..', '..', 'scripts', 'seeds');

// Mutation hatch for scripts/prove-checks.mjs — see gate-adjudicates-never-commits.check.mjs.
const OVERRIDE = process.env.LOOM_SEED_OVERRIDE || '';
const seedFile = (profile) =>
  (OVERRIDE && OVERRIDE.endsWith(`${profile}.json`)) ? OVERRIDE : join(SEEDS, `${profile}.json`);

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

let carries = 0;
for (const profile of ['lite', 'delivery']) {
  const seed = JSON.parse(readFileSync(seedFile(profile), 'utf8'));
  const byId = new Map(seed.nodes.map((n) => [n.id, n]));

  for (const edge of seed.edges) {
    if (!Array.isArray(edge.carry) || edge.carry.length === 0) continue;
    carries++;

    const src = byId.get(edge.from);
    const schema = (src && src.schema) || {};
    const required = new Set(schema.required || []);
    const props = (schema.properties || {});

    for (const field of edge.carry) {
      ok(Object.prototype.hasOwnProperty.call(props, field),
        `${profile}: ${edge.from} -> ${edge.to} carries '${field}' — declared in schema.properties`);
      ok(required.has(field),
        `${profile}: ${edge.from} -> ${edge.to} carries '${field}' — GUARANTEED (in schema.required)`);
    }
  }
}

// A check that scanned nothing proves nothing.
ok(carries >= 3, `scanned every carrying edge in both seeds (found ${carries}, expected >= 3)`);

if (bad) { console.error(`\ncarry-fields-must-be-guaranteed: ${bad} failed`); process.exit(1); }
console.log('carry-fields-must-be-guaranteed: ok');

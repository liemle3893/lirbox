// CHECK — the run may only terminate on a node that REPORTED it succeeded.
//
// delivery's last hop was `PR -> Done` with `when: "always"`, so the run stamped `complete`
// whether or not anything was delivered. Observed in the ratelimit proof run: PR#1 returned
// prUrl="BLOCKED: no PR opened. ... has no git remote" — an honest refusal to invent an
// external side effect — and the interpreter routed it straight to Done and reported
// `complete`. Every gate had genuinely passed, so this is not a soundness hole in the gates;
// it is a reporting hole in the terminal, and `complete` is the word an operator reads as
// "delivered". The seed already had the vocabulary: Review and DoDGate both branch on a
// boolean and route failures backwards, while PR — the ONLY node whose job is an
// irreversible outward-facing action — was the one node with no verdict at all.
//
// lite is the positive control: its terminal edge (Review --passed:true--> Done) was already
// conditional on a required boolean, so this check discriminates rather than blanket-failing.
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

let edges = 0;
for (const profile of ['lite', 'delivery']) {
  const seed = JSON.parse(readFileSync(seedFile(profile), 'utf8'));
  const byId = new Map(seed.nodes.map((n) => [n.id, n]));

  const intoTerminal = seed.edges.filter((e) => e.to === seed.terminal);
  ok(intoTerminal.length > 0, `${profile}: has at least one edge into the terminal`);

  for (const edge of intoTerminal) {
    edges++;
    const src = byId.get(edge.from);
    const schema = (src && src.schema) || {};
    const required = new Set(schema.required || []);
    const props = schema.properties || {};

    // "always" is the whole defect: an unconditional last hop cannot distinguish a delivered
    // run from a blocked one.
    const when = edge.when;
    const conditional = when && typeof when === 'object' && typeof when.field === 'string';
    ok(conditional,
      `${profile}: ${edge.from} -> ${seed.terminal} is CONDITIONAL, not "always"`);
    if (!conditional) continue;

    // ...and the field it branches on must be one the node is obliged to report, and a
    // boolean — a verdict, not a URL string that can carry the word "BLOCKED".
    ok(required.has(when.field),
      `${profile}: ${edge.from} -> ${seed.terminal} branches on '${when.field}', which is REQUIRED`);
    ok((props[when.field] || {}).type === 'boolean',
      `${profile}: ${edge.from} -> ${seed.terminal} branches on '${when.field}', a boolean verdict`);
    ok(when.eq === true,
      `${profile}: ${edge.from} -> ${seed.terminal} is taken only on ${when.field}=true`);
  }
}

// A check that scanned nothing proves nothing.
ok(edges >= 2, `scanned every terminal edge in both seeds (found ${edges}, expected >= 2)`);

if (bad) { console.error(`\nterminal-requires-delivery-verdict: ${bad} failed`); process.exit(1); }
console.log('terminal-requires-delivery-verdict: ok');

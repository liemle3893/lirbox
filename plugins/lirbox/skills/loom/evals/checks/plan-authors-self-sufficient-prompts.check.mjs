// CHECK — the Plan node is told that the prompts IT writes are the only context their
// workers will ever have.
//
// The defect this exists to prevent. A loom plan node returns a graphPatch whose added nodes
// carry prompts the Plan worker authored. Each of those prompts is then handed to a FRESH
// subagent that never sees the plan, the reasoning behind it, or any sibling node's prompt.
// Told only to "add the work nodes you need", a Plan worker writes goal-shaped prompts —
// "implement the exporter" — and every downstream worker has to re-derive the decomposition
// Plan already did, from the repository, one at a time. That rediscovery is the single largest
// line item in a loom run.
//
// This is the cheapest of the context fixes because it adds no machinery at all: the
// information already exists at the moment the prompts are written, and is simply not being
// written down. What it costs is that the invariant lives in PROSE, so this check can only
// prove the instruction is present and intact — never that a model obeyed it. The behavioural
// half is Harbor's job, and a green here is not a claim about worker behaviour.
//
// Because it guards prose, it is deliberately scored rather than matched literally: the two
// load-bearing ideas (write self-sufficient prompts / because the reader is a fresh context)
// must each be present in SOME wording, and enough concrete requirements must survive
// alongside them. Anchoring on one exact sentence would rot the first time anyone rephrased
// it, and would fail for a reason that has nothing to do with the invariant.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Mutation hatch for scripts/prove-checks.mjs: it mutates ONE seed in a copy of the tree and
// points this at it. Resolving the DIRECTORY means every seed in the copy is still examined —
// the mutated one and its untouched sibling — so a mutation cannot pass by being applied to a
// file this check had stopped looking at.
const seedOverride = process.env.LOOM_SEED_OVERRIDE;
const SEEDS = seedOverride
  ? dirname(seedOverride)
  : resolve(HERE, '..', '..', 'scripts', 'seeds');

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

// The two ideas the fix rests on. Neither is optional: the instruction without the reason
// reads as style advice and is the first thing a model drops under pressure.
const MUST = [
  { name: 'demands a self-sufficient prompt',
    re: /self-suffic|independently actionable|stand(s)? alone|stand on its own|without .{0,30}re-?read/i },
  { name: 'says WHY — the reader is a fresh context',
    re: /fresh context|never sees|knows nothing|no memory of|has not read/i },
];

// Concrete content the prompt must require. Not all three — which specifics matter varies by
// task — but a paragraph that demands self-sufficiency while naming none of them has not said
// anything a worker can act on.
const CONCRETE = [
  { name: 'names files', re: /\bfiles?\b/i },
  { name: 'names interfaces/types', re: /signature|type|interface|contract|interfaces/i },
  { name: 'names a completion condition', re: /makes it done|acceptance|condition that|when it is done/i },
];

const seeds = readdirSync(SEEDS).filter((f) => f.endsWith('.json'));
ok(seeds.length > 0, `seeds directory has seeds to examine (${SEEDS})`);

let planned = 0;
for (const f of seeds) {
  let g;
  try { g = JSON.parse(readFileSync(join(SEEDS, f), 'utf8')); }
  catch (e) { ok(false, `${f} is valid JSON (${e.message})`); continue; }

  const plans = (g.nodes || []).filter((n) => n.kind === 'plan');
  if (!plans.length) continue;

  for (const p of plans) {
    planned++;
    const prompt = String(p.prompt || '');

    for (const m of MUST) {
      ok(m.re.test(prompt), `${f}:${p.id} ${m.name}`);
    }

    const hits = CONCRETE.filter((c) => c.re.test(prompt));
    ok(hits.length >= 2,
      `${f}:${p.id} requires concrete content, not just an instruction to be thorough `
      + `(${hits.length}/3: ${JSON.stringify(hits.map((h) => h.name))})`);

    // The node must not have LOST its original job. A mutation that replaces the whole prompt
    // with self-sufficiency prose would satisfy everything above while deleting the reason the
    // node exists — it is the only node that may reshape the graph.
    ok(/graphPatch/.test(prompt),
      `${f}:${p.id} still asks for the graphPatch that adds the work nodes`);
  }
}

// Without this the whole loop is vacuous: a seeds directory where nothing is `kind: "plan"`
// would report a clean pass having examined nothing at all.
ok(planned > 0, `at least one seed actually has a plan node (found ${planned})`);

if (bad) { console.error(`\nplan-authors-self-sufficient-prompts: ${bad} failed`); process.exit(1); }
console.log('plan-authors-self-sufficient-prompts: ok');

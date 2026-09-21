#!/usr/bin/env node
// Headless validator for a plan-check HTML report. Exit 0 = valid, 1 = invalid.
// Enforces the report contract so a report can't silently drift or fabricate a
// verdict that its own claim rows contradict. Regex-based (controlled template).
//
//   node validate.mjs <report.html>
//
// Contract:
//   1. No leftover {{placeholder}} tokens.
//   2. Exactly one element with data-verdict; value in VERDICTS.
//   3. >=1 <tr class="claim">; each carries data-quadrant in QUADRANTS and
//      data-status in STATUSES.
//   4. Verdict is DERIVED from the rows, not asserted:
//        any REFUTED            -> NO-GO
//        else any open item     -> GO-WITH-CONDITIONS   (open = UNVERIFIED | BLIND-SPOT-RISK)
//        else                   -> GO
//      data-verdict must equal the derived verdict.
//   5. Count of class="condition" items == count of open items (every open risk
//      is a condition-to-clear).
//   6. Exactly one <script type="application/json" id="dod"> block whose JSON is
//      { criteria: [{ id, text, tier: 'checkable'|'judged', check? }] } — the
//      machine-readable definition of done consumed by lirbox:conductor.
//   7. The plan's goal (id="goal") + exactly one data-goal-coverage claim row.
//   8. Exactly one <script type="application/json" id="taskgraph"> block: the plan's
//      declared execution shape, with `levels` DERIVED from the edges, not asserted.
//   9. Every OPEN row carries a fix disposition: `fix: mechanical` | `fix: needs-decision`.

import { readFileSync } from 'node:fs';

const VERDICTS = new Set(['GO', 'GO-WITH-CONDITIONS', 'NO-GO']);
const QUADRANTS = new Set(['known-known', 'known-unknown', 'unknown-known', 'unknown-unknown']);
const STATUSES = new Set(['VERIFIED', 'REFUTED', 'UNVERIFIED', 'UNSTATED-ASSUMPTION', 'BLIND-SPOT-RISK']);
const OPEN = new Set(['UNVERIFIED', 'BLIND-SPOT-RISK']);

const path = process.argv[2];
if (!path) {
  console.error('usage: validate.mjs <report.html>');
  process.exit(2);
}

let html;
try {
  html = readFileSync(path, 'utf8');
} catch (e) {
  console.error(`cannot read ${path}: ${e.message}`);
  process.exit(2);
}

const errors = [];
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};

// 1. placeholders (whole file — a leftover token anywhere is a broken render)
const ph = html.match(/\{\{[^}]+\}\}/g);
if (ph) errors.push(`leftover placeholder(s): ${[...new Set(ph)].join(', ')}`);

// Element-level checks (2-5) run on markup only: strip <style> blocks (their
// `.verdict[data-verdict="..."]` attribute selectors are CSS, not verdict
// elements) and HTML comments (template guidance mentions the attributes).
const markup = html
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '');

// 2. verdict
const verdicts = [...markup.matchAll(/data-verdict="([^"]*)"/g)].map((m) => m[1]);
if (verdicts.length !== 1) {
  errors.push(`expected exactly one data-verdict, found ${verdicts.length}`);
} else if (!VERDICTS.has(verdicts[0])) {
  errors.push(`data-verdict="${verdicts[0]}" not in {${[...VERDICTS].join(', ')}}`);
}

// 3. claim rows
const rows = [...markup.matchAll(/<tr\b[^>]*\bclass="[^"]*\bclaim\b[^"]*"[^>]*>/g)].map((m) => m[0]);
if (rows.length === 0) errors.push('no <tr class="claim"> rows found');

let refuted = 0;
let open = 0;
for (const [i, tag] of rows.entries()) {
  const q = attr(tag, 'data-quadrant');
  const s = attr(tag, 'data-status');
  if (!q || !QUADRANTS.has(q)) errors.push(`claim row ${i + 1}: bad data-quadrant=${JSON.stringify(q)}`);
  if (!s || !STATUSES.has(s)) errors.push(`claim row ${i + 1}: bad data-status=${JSON.stringify(s)}`);
  if (s === 'REFUTED') refuted++;
  if (OPEN.has(s)) open++;
}

// 4. derived verdict
if (verdicts.length === 1 && rows.length > 0) {
  const derived = refuted > 0 ? 'NO-GO' : open > 0 ? 'GO-WITH-CONDITIONS' : 'GO';
  if (verdicts[0] !== derived) {
    errors.push(`data-verdict="${verdicts[0]}" contradicts the rows (derived: ${derived}; ${refuted} refuted, ${open} open)`);
  }
}

// 5. conditions == open
const conditions = (markup.match(/class="[^"]*\bcondition\b[^"]*"/g) || []).length;
if (conditions !== open) {
  errors.push(`conditions-to-clear count (${conditions}) != open items (${open})`);
}

// 9. Every OPEN row carries a fix disposition (SKILL.md step 7).
//
// This rule exists because the convention did NOT survive without it. Measured over 20 paired
// Harbor trials, `fix:` appeared in only 4 of 10 reports per arm — while every OTHER element of
// this contract (#dod, id="goal", data-goal-coverage, #taskgraph) landed at ~100%. The difference
// was not the instruction; it was that step 9 loops the model until validate.mjs exits 0, and a
// rule living only in SKILL.md prose never enters that loop.
//
// Needs FULL row bodies, not the opening tags `rows` holds — the disposition lives in the Status
// cell. Rows do not nest, so the non-greedy capture is safe.
const fullRows = [...markup.matchAll(/<tr\b[^>]*\bclass="[^"]*\bclaim\b[^"]*"[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
const FIX = /\bfix:\s*(mechanical|needs-decision)\b/i;
const untagged = fullRows
  .map((r, i) => ({ i: i + 1, s: attr(r, 'data-status') }))
  .filter(({ i, s }) => OPEN.has(s) && !FIX.test(fullRows[i - 1]));
if (untagged.length) {
  errors.push(
    `${untagged.length} open row(s) carry no fix disposition (row ${untagged.map((u) => u.i).join(', ')}) — ` +
      `every UNVERIFIED / BLIND-SPOT-RISK row needs "fix: mechanical" (the repair is determined by ` +
      `the finding) or "fix: needs-decision"; without it a reader cannot tell what can be applied`
  );
}

// 7. the plan's GOAL, and one adjudicated row tying the DoD back to it.
//
// Both halves or neither. A goal printed in the header is decoration: the failure this catches is
// a plan whose DoD is fully checkable and does not achieve the objective, and only the
// adjudication sees that. Kept in validate.mjs rather than left to prose because an optional
// field is one that gets skipped.
// \1 backreferences the tag name so the capture runs to the element's OWN closing tag. A plain
// non-greedy `<\/[a-zA-Z]+>` stops at the first nested close (`</strong>` in the template's
// "<strong>Goal:</strong> …"), which reads as an empty goal on a perfectly good report.
const goalEl = [...markup.matchAll(/<([a-zA-Z]+)[^>]*\bid="goal"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2]);
if (goalEl.length !== 1) {
  errors.push(`expected exactly one element with id="goal" (the plan's goal), found ${goalEl.length}`);
} else if (!goalEl[0].replace(/<[^>]+>/g, '').replace(/Goal:/i, '').trim()) {
  errors.push('id="goal" is empty — state what the plan is trying to achieve, or say the plan states none');
}

const goalRows = rows.filter((tag) => attr(tag, 'data-goal-coverage') !== null);
if (goalRows.length !== 1) {
  errors.push(
    `expected exactly one claim row with data-goal-coverage (does meeting every DoD criterion ` +
      `achieve the goal?), found ${goalRows.length}`
  );
}

// 6. machine-readable DoD block (consumed by lirbox:conductor)
let dodCount = 0;
const dodBlocks = [...html.matchAll(/<script type="application\/json" id="dod">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (dodBlocks.length !== 1) {
  errors.push(`expected exactly one <script type="application/json" id="dod"> block, found ${dodBlocks.length}`);
} else {
  let dod = null;
  try { dod = JSON.parse(dodBlocks[0]); } catch (e) { errors.push(`#dod block is not valid JSON: ${e.message}`); }
  const list = dod && Array.isArray(dod.criteria) ? dod.criteria : null;
  if (dod && (!list || !list.length)) errors.push('#dod block needs a non-empty criteria array');
  if (list) {
    dodCount = list.length;
    for (const [i, c] of list.entries()) {
      if (!c.id || !c.text || (c.tier !== 'checkable' && c.tier !== 'judged')) {
        errors.push(`#dod criterion ${i + 1}: needs id, text, and tier=checkable|judged`);
      }
      if (c.tier === 'checkable' && (typeof c.check !== 'string' || !c.check.trim())) {
        errors.push(`#dod criterion ${i + 1} ('${c.id || '?'}'): checkable needs a non-empty check command`);
      }
    }
  }
}

// 8. machine-readable TASK GRAPH — what may run concurrently, and what may not.
//
// The point of this block is that `levels` is DERIVED, never asserted: it is recomputed here by
// longest-path layering over the `needs` edges and must match what the report declared. Without
// that, a report can emit levels [[a],[b],[c]] with no edges at all and pass — a fully serial
// claim with nothing backing it, which is exactly the dishonesty this is for.
//
// Two edge kinds, because they are not the same constraint and a runner treats them differently:
//   needs      — B requires A's OUTPUT (a decision, an API, a schema, code that must exist).
//                A real ordering constraint. Constrains levels.
//   contention — two tasks write the same file. Under a runner giving each task its own worktree
//                (lirbox:conductor does) this is a MERGE cost at integration, NOT an ordering
//                constraint, so it does NOT constrain levels. A runner sharing one working tree
//                must promote it to `needs`. Recording it as `needs` here would serialize work
//                that has no data dependency.
let graphNodes = 0;
let graphLevels = 0;
const tgBlocks = [...html.matchAll(/<script type="application\/json" id="taskgraph">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (tgBlocks.length !== 1) {
  errors.push(`expected exactly one <script type="application/json" id="taskgraph"> block, found ${tgBlocks.length}`);
} else {
  let tg = null;
  try { tg = JSON.parse(tgBlocks[0]); } catch (e) { errors.push(`#taskgraph block is not valid JSON: ${e.message}`); }
  const nodes = tg && Array.isArray(tg.nodes) ? tg.nodes : null;
  const edges = tg && Array.isArray(tg.edges) ? tg.edges : null;
  const levels = tg && Array.isArray(tg.levels) ? tg.levels : null;
  if (tg && (!nodes || !edges || !levels)) {
    errors.push('#taskgraph needs arrays: nodes, edges, levels (all three; use [] when the plan declares no task graph)');
  } else if (tg) {
    // nodes: unique non-empty ids
    const ids = new Set();
    for (const [i, n] of nodes.entries()) {
      const id = n && typeof n.id === 'string' ? n.id.trim() : '';
      if (!id) { errors.push(`#taskgraph node ${i + 1}: needs a non-empty id`); continue; }
      if (ids.has(id)) errors.push(`#taskgraph node ${i + 1}: duplicate id "${id}"`);
      if (n.files !== undefined && !Array.isArray(n.files)) errors.push(`#taskgraph node "${id}": files must be an array`);
      ids.add(id);
    }
    graphNodes = ids.size;

    // edges: resolve, kind, and a stated reason. `why` is required because an unexplained edge is
    // the thing this whole block exists to stop being invented.
    const needs = [];
    const linked = new Set();
    for (const [i, e] of edges.entries()) {
      const from = e && typeof e.from === 'string' ? e.from : '';
      const to = e && typeof e.to === 'string' ? e.to : '';
      const where = `#taskgraph edge ${i + 1}`;
      if (!ids.has(from) || !ids.has(to)) {
        errors.push(`${where}: ${JSON.stringify(from)} -> ${JSON.stringify(to)} names a node that does not exist`);
        continue;
      }
      if (from === to) { errors.push(`${where}: "${from}" depends on itself`); continue; }
      if (e.kind !== 'needs' && e.kind !== 'contention') {
        errors.push(`${where} ("${from}" -> "${to}"): kind must be "needs" (ordering) or "contention" (same file, merge cost)`);
        continue;
      }
      if (typeof e.why !== 'string' || !e.why.trim()) {
        errors.push(`${where} ("${from}" -> "${to}"): needs a non-empty why — an edge with no stated reason is an invented one`);
      }
      linked.add(from < to ? `${from} ${to}` : `${to} ${from}`);
      if (e.kind === 'needs') needs.push([from, to]);
    }

    // Every file claimed by two tasks must be CLASSIFIED by an edge between them. Silence here is
    // the failure mode: the plan reads as if the tasks were independent when they collide.
    const byFile = new Map();
    for (const n of nodes) {
      const id = n && typeof n.id === 'string' ? n.id.trim() : '';
      if (!id) continue;
      for (const f of Array.isArray(n.files) ? n.files : []) {
        if (!byFile.has(f)) byFile.set(f, []);
        if (!byFile.get(f).includes(id)) byFile.get(f).push(id);
      }
    }
    for (const [f, owners] of byFile) {
      for (let a = 0; a < owners.length; a++) {
        for (let b = a + 1; b < owners.length; b++) {
          const [x, y] = [owners[a], owners[b]];
          const key = x < y ? `${x} ${y}` : `${y} ${x}`;
          if (!linked.has(key)) {
            errors.push(
              `#taskgraph: "${f}" is claimed by both "${x}" and "${y}" with no edge between them — ` +
                `classify it (kind "contention" if they may still run concurrently in separate worktrees, "needs" if not)`
            );
          }
        }
      }
    }

    // LEVELS ARE DERIVED. Kahn layering over `needs` only: a node sits one level below the latest
    // thing it needs. contention edges are deliberately absent from this — they cost a merge, not
    // an ordering. A leftover set after layering is a cycle, and it is named.
    if (!errors.some((e) => e.startsWith('#taskgraph'))) {
      const level = new Map([...ids].map((id) => [id, 0]));
      let settled = new Set([...ids].filter((id) => !needs.some(([, to]) => to === id)));
      let frontier = settled;
      let depth = 0;
      while (frontier.size && settled.size < ids.size) {
        depth++;
        const next = new Set(
          [...ids].filter((id) => !settled.has(id) && needs.every(([from, to]) => to !== id || settled.has(from)))
        );
        for (const id of next) level.set(id, depth);
        frontier = next;
        settled = new Set([...settled, ...next]);
      }
      if (settled.size < ids.size) {
        errors.push(
          `#taskgraph: needs-edge cycle among ${[...ids].filter((id) => !settled.has(id)).sort().join(', ')} — ` +
            `no execution order exists; one of those edges is not a real dependency`
        );
      } else {
        const expected = [];
        for (const id of [...ids].sort()) {
          const d = level.get(id);
          (expected[d] || (expected[d] = [])).push(id);
        }
        graphLevels = expected.length;
        const shown = (ls) => ls.map((l) => `[${[...l].map(String).sort().join(' ')}]`).join(' ');
        const same =
          levels.length === expected.length &&
          expected.every((want, i) => {
            const got = Array.isArray(levels[i]) ? [...levels[i]].map(String).sort() : null;
            return got && got.length === want.length && want.every((id, j) => got[j] === id);
          });
        if (!same) {
          errors.push(
            `#taskgraph levels are not what the edges imply — declared ${shown(levels)}, ` +
              `derived ${shown(expected)}. Levels are computed from the "needs" edges, not chosen: ` +
              `extra levels claim serialization no edge justifies, missing ones claim parallelism the edges forbid`
          );
        }
      }
    }
  }
}

if (errors.length) {
  console.error(`INVALID ${path}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `VALID ${path} — verdict ${verdicts[0]}, ${rows.length} claim(s), ${open} open, ${conditions} condition(s), ` +
    `${dodCount} DoD criteria, ${graphNodes} task(s) in ${graphLevels} level(s)`
);

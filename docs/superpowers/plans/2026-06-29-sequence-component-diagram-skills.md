# Sequence-diagram & Component-diagram Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two HTML-artifact skills to the `lirbox` plugin — `component-diagram` (static structure) and `sequence-diagram` (time-ordered interaction) — each a self-contained interactive HTML page modeled on `flowchart`, with a headless validator gate and a minimal evals floor.

**Architecture:** Both skills mirror `flowchart`'s anatomy (`SKILL.md` + `references/components.md` + `assets/template.html` + `assets/validate.mjs` + `evals/`). `component-diagram` is a `flowchart`/`graph` with `subgraph` boundaries and per-node `click`→panel; its validator reuses flowchart's escaping checker verbatim plus structural greps. `sequence-diagram` is a `sequenceDiagram` with `autonumber` and a numbered side-list (not SVG clicks) driving the panel; its validator is new. Build `component-diagram` first to de-risk the shared backbone, then `sequence-diagram`, then repo wiring + end-to-end verification.

**Tech Stack:** Mermaid 11.15.0 (CDN, SRI-pinned), zero-dependency Node ESM validators (`node:fs` only), single-file HTML/CSS/vanilla-JS artifacts.

## Global Constraints

- Work on a branch off `main`: `feat/diagram-skills`. Never commit these to `main` directly.
- Commit identity is githook-enforced `liemle3893`; every commit message ends with the trailer `Claude-Session: https://claude.ai/code/session_015bmgsXd4EDEe92LQdsPtTZ`.
- Mermaid is pinned **exactly**: `https://cdn.jsdelivr.net/npm/mermaid@11.15.0/dist/mermaid.min.js` with `integrity="sha384-yQ4mmBBT+vhTAwjFH0toJXNYJ6O4usWnt6EPIdWwrRvx2V/n5lXuDZQwQFeSFydF"` and `crossorigin="anonymous" referrerpolicy="no-referrer"`. Copy the `<script>` line verbatim from `plugins/lirbox/skills/flowchart/assets/template.html:149-151`. Never drop `integrity`/`crossorigin`.
- Both skills are **non-offline** (Mermaid from CDN) — every `SKILL.md` and `components.md` must state this, matching flowchart.
- `validate.mjs`: zero npm deps, `node:fs` only, no network, no browser. Exit 0 = clean, exit 1 = ≥1 finding or no files found. Same I/O contract as `flowchart/assets/validate.mjs`.
- Each `SKILL.md` frontmatter `name:` MUST equal its directory name (kebab-case). `description:` is the trigger — third person, explicit *when*, and sharply contrasted with flowchart's.
- Warm-editorial palette and layout are inherited from flowchart's `template.html` `<style>` block — keep it byte-for-byte unless a step says otherwise.
- Grounding honesty bar: when tracing a real repo, every participant/component, message/dependency, and `file:line` must be real (read the files). When conceptual, stay faithful to the user's prose. Invent nothing; frame estimates as estimates.
- `claude plugin validate .` must pass before the final commit.

---

### Task 1: Scaffold `component-diagram` skill + template + clean fixture

**Files:**
- Create: `plugins/lirbox/skills/component-diagram/assets/template.html` (adapted copy of flowchart's)
- Create: `plugins/lirbox/skills/component-diagram/evals/fixtures/clean.html`

**Interfaces:**
- Produces: the component HTML output contract consumed by Task 2's validator —
  - exactly one `<pre class="mermaid">` whose first non-comment line is `flowchart LR` (or `TD`);
  - node labels are `id[Label]` rectangles only (NO `{diamond}`, NO `[(cyl)]`/`([stadium])` exotic shapes);
  - `subgraph <id>[<Title>]` … `end` boundaries (≥1);
  - typed **ASCII** edge labels: `A -->|calls| B`, dashed `A -.->|publishes| B` for async/events;
  - one `:::crit` node; `classDef` block kept; one `click <id> selectNode "details"` per node;
  - a `STEPS` object (keys == node ids) between `// TEMPLATE-STEPS-START/END`; `DEFAULT_NODE` a real key.

- [ ] **Step 1: Create the branch**

Run:
```bash
git checkout -b feat/diagram-skills
```
Expected: `Switched to a new branch 'feat/diagram-skills'`

- [ ] **Step 2: Copy flowchart's template as the starting point**

Run:
```bash
mkdir -p plugins/lirbox/skills/component-diagram/assets plugins/lirbox/skills/component-diagram/evals/fixtures plugins/lirbox/skills/component-diagram/evals/floor plugins/lirbox/skills/component-diagram/references
cp plugins/lirbox/skills/flowchart/assets/template.html plugins/lirbox/skills/component-diagram/assets/template.html
```
Expected: no output; the file exists.

- [ ] **Step 3: Edit the template's prose, title, and eyebrow**

In `plugins/lirbox/skills/component-diagram/assets/template.html`:
- Replace the top comment block (`<!-- FLOWCHART TEMPLATE … -->`) with:
```html
<!--
  COMPONENT-DIAGRAM TEMPLATE — single HTML file. Renders a static component/architecture
  map with Mermaid (flowchart + subgraph boundaries, loaded from CDN) + a clickable
  per-node detail panel. NEEDS INTERNET to render (Mermaid is fetched from a CDN).

  HOW TO USE:
  1. Replace the graph inside <pre class="mermaid"> … </pre> (between TEMPLATE-GRAPH markers)
     with the real components. Use `flowchart LR`, `subgraph` for system/layer boundaries,
     typed ASCII edge labels (|calls| |reads| |publishes|). NO decision diamonds {…}.
     Use plain id[Label] rectangles only (no [(cylinder)]/([stadium]) shapes). Both markers gone.
  2. Replace the STEPS object (between TEMPLATE-STEPS markers) — one entry per node id, with
     title/meta/body. Use the interface/deps body shape shown. Both markers gone.
  3. Replace every {{PLACEHOLDER}}; set DEFAULT_NODE.
  Keep the <style> block and the Mermaid init/JS wiring intact.
  Component + syntax guide: references/components.md.
-->
```
- `<title>`: `Component diagram — {{TITLE}}`
- eyebrow line: `<p class="eyebrow">Component map · {{PROJECT_OR_SUBSYSTEM}}</p>`
- `h1.title`: `{{TITLE — e.g. "Checkout service: components & dependencies"}}`
- lead: `{{1_3_SENTENCE_LEAD — what this system is and how its parts connect. Click any component for detail.}}`

- [ ] **Step 4: Replace the graph (between `%% TEMPLATE-GRAPH-START` and `%% TEMPLATE-GRAPH-END`)**

```
%% TEMPLATE-GRAPH-START — replace with the real components, then delete both markers.
flowchart LR
  subgraph edge[Edge]
    gw[API Gateway]:::crit
  end
  subgraph svc[Services]
    auth[Auth Service]
    orders[Orders Service]
  end
  subgraph data[Data stores]
    pg[Postgres]
    cache[Redis]
  end
  gw -->|routes| auth
  gw -->|routes| orders
  auth -->|reads| pg
  orders -->|reads + writes| pg
  orders -.->|publishes events| cache

  classDef boundary fill:#F3EFE6,stroke:#E3DACC,color:#141413;
  classDef store fill:#EEF1E7,stroke:#788C5D,color:#3A3A37;
  classDef crit fill:#FBEDE7,stroke:#D97757,stroke-width:2px,color:#B04A3F;

  click gw selectNode "details"
  click auth selectNode "details"
  click orders selectNode "details"
  click pg selectNode "details"
  click cache selectNode "details"
%% TEMPLATE-GRAPH-END
```
Note: edge labels stay ASCII (`reads + writes`, not `reads/writes` is fine too — both ASCII). Dashed `-.->` = async/event.

- [ ] **Step 5: Replace the legend block (inside `<aside>`)**

Replace the `<div class="legend">…</div>` with:
```html
    <div class="legend">
      <p class="lbl">Legend</p>
      <div class="leg"><span class="swatch proc"></span> component</div>
      <div class="leg"><span class="swatch dec"></span> boundary (subgraph)</div>
      <div class="leg"><span class="swatch ok"></span> data store</div>
      <div class="leg"><span class="swatch fail"></span> control point (critical)</div>
      <div class="leg"><span class="swatch line"></span> sync dependency</div>
      <div class="leg"><span class="swatch no"></span> async / event (dashed)</div>
    </div>
```

- [ ] **Step 6: Replace the STEPS object (between `// TEMPLATE-STEPS-START` and `// TEMPLATE-STEPS-END`) with the component-shaped panel**

```js
    // TEMPLATE-STEPS-START — one entry per node id; body shows responsibility / interface / deps.
    gw:     { title: "API Gateway", meta: ["edge", "control point"],
              body: "<p><b>Responsibility:</b> single ingress; authn, routing, rate-limit.</p><p><b>Exposes:</b> <code>:443</code> HTTPS.</p><p><b>Depends on:</b> Auth, Orders.</p>" },
    auth:   { title: "Auth Service", meta: ["service"],
              body: "<p><b>Responsibility:</b> issues + verifies tokens.</p><p><b>Exposes:</b> <code>/verify</code>, <code>/login</code>.</p><p><b>Depends on:</b> Postgres.</p>" },
    orders: { title: "Orders Service", meta: ["service"],
              body: "<p><b>Responsibility:</b> order lifecycle.</p><p><b>Exposes:</b> <code>/orders</code>.</p><p><b>Depends on:</b> Postgres, Redis (events).</p>" },
    pg:     { title: "Postgres", meta: ["datastore"],
              body: "<p><b>Responsibility:</b> system of record.</p><p><b>Read by:</b> Auth, Orders.</p>" },
    cache:  { title: "Redis", meta: ["datastore", "events"],
              body: "<p><b>Responsibility:</b> event stream + cache.</p><p><b>Written by:</b> Orders.</p>" },
    // TEMPLATE-STEPS-END
```
Leave `const DEFAULT_NODE = "gw";` (replace `"start"`).

- [ ] **Step 7: Verify the template still has its wiring intact**

Run:
```bash
grep -c 'integrity=' plugins/lirbox/skills/component-diagram/assets/template.html
grep -c 'selectNode' plugins/lirbox/skills/component-diagram/assets/template.html
grep -c 'TEMPLATE-GRAPH\|TEMPLATE-STEPS' plugins/lirbox/skills/component-diagram/assets/template.html
```
Expected: `1` (integrity present), `≥6` (selectNode fn + click lines), `4` (both marker pairs still present — template keeps them; only generated output deletes them).

- [ ] **Step 8: Create the clean fixture (a filled, marker-free copy)**

Copy the template to the fixture, then remove the four `TEMPLATE-*` marker comment lines (keep the content between them) so it represents real generated output.

Run:
```bash
cp plugins/lirbox/skills/component-diagram/assets/template.html plugins/lirbox/skills/component-diagram/evals/fixtures/clean.html
```
Then edit `evals/fixtures/clean.html`: delete the 2 `%% TEMPLATE-GRAPH-*` lines and the 2 `// TEMPLATE-STEPS-*` lines, and replace every `{{…}}` placeholder with real text (title "Checkout service: components & dependencies", project "checkout", lead one sentence, footer date "2026-06-29"). This fixture must contain zero `{{` and zero `TEMPLATE-`.

- [ ] **Step 9: Confirm the clean fixture has no leftovers**

Run:
```bash
grep -c '{{' plugins/lirbox/skills/component-diagram/evals/fixtures/clean.html
grep -c 'TEMPLATE-' plugins/lirbox/skills/component-diagram/evals/fixtures/clean.html
```
Expected: `0` and `0`.

- [ ] **Step 10: Commit**

```bash
git add plugins/lirbox/skills/component-diagram/assets/template.html plugins/lirbox/skills/component-diagram/evals/fixtures/clean.html
git commit -m "feat(component-diagram): template + clean fixture"
```

---

### Task 2: `component-diagram` validator (TDD against fixtures)

**Files:**
- Create: `plugins/lirbox/skills/component-diagram/assets/validate.mjs`
- Create: `plugins/lirbox/skills/component-diagram/evals/fixtures/raw-paren.html` (broken)
- Create: `plugins/lirbox/skills/component-diagram/evals/fixtures/diamond.html` (broken)
- Create: `plugins/lirbox/skills/component-diagram/evals/fixtures/no-subgraph.html` (broken)

**Interfaces:**
- Consumes: the clean fixture from Task 1.
- Produces: `validate.mjs` with CLI `node validate.mjs <file.html> …` (defaults to `./*-component.html`). Exit 0 iff every check passes. Consumed by Task 3's floor test.

- [ ] **Step 1: Write the three broken fixtures FIRST (these are the failing tests)**

Create `evals/fixtures/raw-paren.html` — copy `clean.html`, then change one node label to contain a raw paren, e.g. `auth[Auth Service]` → `auth[Auth #40;jwt#41; Service]` is CORRECT; the broken version is `auth[Auth (jwt) Service]` (raw `(` `)`). Leave everything else clean.

Create `evals/fixtures/diamond.html` — copy `clean.html`, then change `gw[API Gateway]:::crit` to a diamond `gw{API Gateway}:::crit` (forbidden shape).

Create `evals/fixtures/no-subgraph.html` — copy `clean.html`, then delete all three `subgraph …`/`end` lines (keep the nodes), leaving a boundary-less graph.

- [ ] **Step 2: Run the not-yet-existing validator to confirm RED**

Run:
```bash
node plugins/lirbox/skills/component-diagram/assets/validate.mjs plugins/lirbox/skills/component-diagram/evals/fixtures/raw-paren.html
```
Expected: FAIL — `Error: Cannot find module …/validate.mjs` (file doesn't exist yet).

- [ ] **Step 3: Implement `validate.mjs`**

Reuse flowchart's escaping engine verbatim, add component structural checks:
```js
#!/usr/bin/env node
// Headless static validator for component-diagram output. Zero deps (node:fs).
// Reuses flowchart's 4 label-escaping rules (same flowchart/graph syntax) and adds
// component structural checks: a mermaid block exists & is a flowchart/graph, ≥1 subgraph,
// no decision diamonds, every click id has a STEPS entry, DEFAULT_NODE resolves, exactly
// one :::crit, SRI intact, no leftover template markers/placeholders.
// Usage: node validate.mjs <file.html> [more…]   (defaults to ./*-component.html)
import { readFileSync, readdirSync } from 'node:fs';

const SPECIALS = ['(', ')', '{', '}', '[', ']', '"'];
const ENTITY = { '(': '#40;', ')': '#41;', '{': '#123;', '}': '#125;', '[': '#91;', ']': '#93;', '"': '#34;' };

function mermaidBlocks(html) {
  const re = /<pre[^>]*class=["'][^"']*\bmermaid\b[^"']*["'][^>]*>([\s\S]*?)<\/pre>/gi;
  const out = []; let m;
  while ((m = re.exec(html))) out.push({ text: m[1], startLine: html.slice(0, m.index).split('\n').length });
  return out;
}
function isStructural(t) {
  return t === '' || t.startsWith('%%') || t.startsWith('classDef') || t.startsWith('click') ||
    t.startsWith('style ') || t.startsWith('linkStyle') || t.startsWith('subgraph') ||
    t === 'end' || /^(flowchart|graph)\b/.test(t);
}
function spans(line) {
  const labels = [], edges = [];
  for (const mm of line.matchAll(/\|([^|]*)\|/g)) edges.push(mm[1]);
  for (const mm of line.matchAll(/\[([^\]]*)\]/g)) labels.push(mm[1]);
  for (const mm of line.matchAll(/\{([^}]*)\}/g)) labels.push(mm[1]);
  return { labels, edges };
}
function checkLabel(text, { edge }) {
  const issues = [];
  for (const ch of SPECIALS) if (text.includes(ch)) issues.push(`raw "${ch}" in ${edge ? 'edge ' : ''}label — use Mermaid entity ${ENTITY[ch]}`);
  if (/&#\d+;|&#x[0-9a-f]+;/i.test(text)) issues.push(`HTML entity "&#…;" in label — use Mermaid's "#NN;" (no ampersand)`);
  if (text.includes('\\n')) issues.push(`literal "\\n" in label — use <br/> for a line break`);
  if (edge && /[^\x00-\x7F]/.test(text)) {
    const bad = [...new Set([...text].filter((c) => c.charCodeAt(0) > 127))].join(' ');
    issues.push(`non-ASCII (${bad}) in edge label — btoa() throws at render; map —→- …→... →→->`);
  }
  return issues;
}

function validateFile(file) {
  let html;
  try { html = readFileSync(file, 'utf8'); } catch (e) { return [{ line: 0, msg: `cannot read: ${e.message}` }]; }
  const findings = [];
  const push = (line, msg, snippet) => findings.push({ line, msg, snippet });

  // Whole-file structural checks
  if (/\{\{/.test(html)) push(0, 'leftover {{…}} placeholder');
  if (/TEMPLATE-(GRAPH|STEPS)/.test(html)) push(0, 'leftover TEMPLATE-* marker — delete markers in generated output');
  if (!/integrity=/.test(html) || !/crossorigin/.test(html)) push(0, 'Mermaid <script> is missing integrity/crossorigin (SRI)');
  const critCount = (html.match(/:::crit\b/g) || []).length;
  if (critCount !== 1) push(0, `expected exactly one :::crit node, found ${critCount}`);

  const blocks = mermaidBlocks(html);
  if (blocks.length === 0) return [...findings, { line: 0, msg: 'no <pre class="mermaid"> block found' }];

  for (const b of blocks) {
    const lines = b.text.split('\n');
    const joined = b.text;
    if (!/^\s*(flowchart|graph)\b/m.test(joined)) push(b.startLine, 'mermaid block is not a flowchart/graph');
    if (!/^\s*subgraph\b/m.test(joined)) push(b.startLine, 'no subgraph boundary — a component diagram needs ≥1 boundary');

    lines.forEach((raw, i) => {
      const t = raw.trim();
      const line = b.startLine + i;
      // diamond shape id{...} is forbidden (that is flowchart's job)
      if (!t.startsWith('classDef') && /[\w)\]]\s*\{[^{}]*\}/.test(t)) push(line, 'decision diamond {…} not allowed in a component diagram');
      if (isStructural(t)) return;
      const { labels, edges } = spans(raw);
      for (const l of labels) for (const msg of checkLabel(l, { edge: false })) push(line, msg, t);
      for (const e of edges) for (const msg of checkLabel(e, { edge: true })) push(line, msg, t);
    });
  }

  // click ↔ STEPS parity
  const clickIds = [...html.matchAll(/click\s+(\w+)\s+selectNode/g)].map((m) => m[1]);
  const stepsBlock = (html.match(/const\s+STEPS\s*=\s*\{([\s\S]*?)\};/) || [, ''])[1];
  const stepKeys = new Set([...stepsBlock.matchAll(/^\s*(\w+)\s*:\s*\{/gm)].map((m) => m[1]));
  for (const id of clickIds) if (!stepKeys.has(id)) push(0, `click target "${id}" has no STEPS entry`);
  const def = (html.match(/const\s+DEFAULT_NODE\s*=\s*["'](\w+)["']/) || [])[1];
  if (!def || !stepKeys.has(def)) push(0, `DEFAULT_NODE "${def || '(unset)'}" is not a STEPS key`);

  return findings;
}

let files = process.argv.slice(2);
if (files.length === 0) { try { files = readdirSync('.').filter((f) => f.endsWith('-component.html')); } catch { files = []; } }
if (files.length === 0) { console.error('validate.mjs: no files given and no *-component.html in cwd'); process.exit(1); }

let total = 0;
for (const file of files) {
  const findings = validateFile(file);
  if (findings.length === 0) { console.log(`PASS  ${file}`); continue; }
  total += findings.length;
  console.log(`FAIL  ${file}  (${findings.length})`);
  for (const f of findings) { console.log(`  ${file}:${f.line}  ${f.msg}`); if (f.snippet) console.log(`        ${f.snippet}`); }
}
if (total > 0) { console.error(`\n${total} finding(s) across ${files.length} file(s).`); process.exit(1); }
console.log(`\nAll ${files.length} file(s) clean.`);
```

- [ ] **Step 4: Run the validator against all fixtures (verify GREEN/RED as expected)**

Run:
```bash
node plugins/lirbox/skills/component-diagram/assets/validate.mjs plugins/lirbox/skills/component-diagram/evals/fixtures/clean.html
node plugins/lirbox/skills/component-diagram/assets/validate.mjs plugins/lirbox/skills/component-diagram/evals/fixtures/raw-paren.html; echo "exit=$?"
node plugins/lirbox/skills/component-diagram/assets/validate.mjs plugins/lirbox/skills/component-diagram/evals/fixtures/diamond.html; echo "exit=$?"
node plugins/lirbox/skills/component-diagram/assets/validate.mjs plugins/lirbox/skills/component-diagram/evals/fixtures/no-subgraph.html; echo "exit=$?"
```
Expected: `PASS  …/clean.html`; then three `FAIL …` blocks each with `exit=1` (raw-paren flags `raw "(" …`; diamond flags `decision diamond …`; no-subgraph flags `no subgraph boundary …`).

- [ ] **Step 5: Commit**

```bash
git add plugins/lirbox/skills/component-diagram/assets/validate.mjs plugins/lirbox/skills/component-diagram/evals/fixtures/raw-paren.html plugins/lirbox/skills/component-diagram/evals/fixtures/diamond.html plugins/lirbox/skills/component-diagram/evals/fixtures/no-subgraph.html
git commit -m "feat(component-diagram): headless validator + broken fixtures"
```

---

### Task 3: `component-diagram` evals floor

**Files:**
- Create: `plugins/lirbox/skills/component-diagram/evals/floor/structure.test.mjs`
- Create: `plugins/lirbox/skills/component-diagram/evals/run.mjs`

**Interfaces:**
- Consumes: `validate.mjs` + the four fixtures from Tasks 1–2.
- Produces: `run.mjs` floor runner (exit 0 iff all `floor/*.test.mjs` pass). Same contract as flowchart's `evals/run.mjs`.

- [ ] **Step 1: Write the floor characterization test (PASSES on baseline)**

Create `evals/floor/structure.test.mjs`:
```js
// FLOOR (characterization) — PASSES on the committed baseline. Asserts behavior validate.mjs
// ALREADY has, so it can't go red without a regression. Locked (evals/**): never edited by a fixer.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE = join(HERE, '..', '..', 'assets', 'validate.mjs');
const FIX = (n) => join(HERE, '..', 'fixtures', n);
function validateExit(fixture) {
  try { execFileSync('node', [VALIDATE, FIX(fixture)], { stdio: 'pipe' }); return 0; }
  catch (e) { return typeof e.status === 'number' ? e.status : 1; }
}
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log(`PASS floor: ${msg}`); else { console.error(`FAIL floor: ${msg}`); failures++; } };

ok(validateExit('clean.html') === 0, 'a clean component diagram passes (exit 0)');
ok(validateExit('raw-paren.html') === 1, 'a raw "(" in a node label is flagged (exit 1)');
ok(validateExit('diamond.html') === 1, 'a decision diamond {…} is flagged (exit 1)');
ok(validateExit('no-subgraph.html') === 1, 'a boundary-less graph is flagged (exit 1)');

if (failures) { console.error(`\n${failures} floor check(s) FAILED`); process.exit(1); }
console.log('\nfloor: component structure characterization green.');
```

- [ ] **Step 2: Write the floor runner**

Create `evals/run.mjs` — copy `plugins/lirbox/skills/flowchart/evals/run.mjs` verbatim, then change the header comment's path reference from `…/flowchart/evals/run.mjs` to `…/component-diagram/evals/run.mjs`. The runner logic (read `floor/*.test.mjs`, run each, exit 0 iff all pass) is identical.

Run:
```bash
cp plugins/lirbox/skills/flowchart/evals/run.mjs plugins/lirbox/skills/component-diagram/evals/run.mjs
```
Then edit the one path reference in the header comment.

- [ ] **Step 3: Run the floor (verify GREEN)**

Run:
```bash
node plugins/lirbox/skills/component-diagram/evals/run.mjs
```
Expected: `floor PASS  structure.test.mjs` then `FLOOR GREEN: 1/1 floor test(s) passed.` (exit 0).

- [ ] **Step 4: Commit**

```bash
git add plugins/lirbox/skills/component-diagram/evals/floor/structure.test.mjs plugins/lirbox/skills/component-diagram/evals/run.mjs
git commit -m "feat(component-diagram): evals floor (characterization + runner)"
```

---

### Task 4: `component-diagram` SKILL.md + components.md

**Files:**
- Create: `plugins/lirbox/skills/component-diagram/SKILL.md`
- Create: `plugins/lirbox/skills/component-diagram/references/components.md`

**Interfaces:**
- Consumes: template, validator, evals from Tasks 1–3 (referenced by path in the workflow).
- Produces: the skill entry-point. `name: component-diagram`.

- [ ] **Step 1: Write `SKILL.md`**

```markdown
---
name: component-diagram
description: This skill should be used to draw the STATIC STRUCTURE of a system as a self-contained interactive HTML component diagram — a Mermaid flowchart with subgraph boundaries (systems/layers), typed dependency edges (calls/reads/publishes), and a clickable per-component detail panel (responsibility, interface, dependencies). Triggers when the user asks to "diagram the components", "show the architecture / module map", "what talks to what", "draw the service/dependency graph", or "map this system's structure". For a branching PROCESS with decisions use flowchart; for a time-ordered interaction use sequence-diagram; for one traced path use codewalk.

# NOTE: output loads Mermaid from a CDN, so the page needs internet to render.
---

# component-diagram

Turn a system's static structure into one self-contained interactive HTML page: a Mermaid
`flowchart` with `subgraph` boundaries and typed dependency edges, plus a clickable panel
that gives each component its responsibility, interface, and dependencies. Warm editorial
design shared with `flowchart`/`codewalk`/`plan-deck`/`pr-writeup`.

**Offline caveat:** the page fetches Mermaid from a CDN (pinned + SRI). It needs internet to
render — mention this when delivering.

## When to use

Use it for **static structure** — components/services/modules, their boundaries, and what
depends on what. NOT for a branching process (use `flowchart`) or a time-ordered interaction
(use `sequence-diagram`). No decision diamonds appear in a component diagram.

## Inputs

- A **system** to map — from prose, or traced from a real repo. If tracing, read the files so
  component names, interfaces, and dependency edges are real (honesty bar: invent nothing).

## Workflow

### 1. Map the structure
List the components, group them into boundaries (systems/layers → `subgraph`s), and the
typed dependencies between them (calls / reads / publishes; dashed for async/events).
Identify the **one critical component** (the control point). If tracing, read the files.

### 2. Write the graph + detail
Read `references/components.md` (shape/edge syntax, escaping rules, the `STEPS` map). Copy
`assets/template.html`, then: replace the graph between `TEMPLATE-GRAPH`, the `STEPS` between
`TEMPLATE-STEPS`, fill the `{{…}}`, set `DEFAULT_NODE`. Keep the `<style>` and Mermaid wiring.
**Use only `id[Label]` rectangles (no diamonds, no cylinder/stadium shapes) and ASCII edge
labels** — the validator enforces this. Default output path: `./<slug>-component.html`.

### 3. Verify before claiming done
- **Run the validator — the headless gate:** `node <skill-dir>/assets/validate.mjs <output>.html`
  must print `PASS` / exit 0. It catches label-escaping breakers, decision diamonds, missing
  boundaries, missing SRI, click↔STEPS mismatches, and leftover markers. Fix and re-run until clean.
- Both `TEMPLATE-GRAPH`/`TEMPLATE-STEPS` marker pairs removed; zero `{{…}}`.
- Every node id has a `click` line and a matching `STEPS` entry; `DEFAULT_NODE` is a real key.
- Exactly one `:::crit`; ≥1 `subgraph`; one `<h1 class="title">`; SRI intact.
- Optional (needs internet): open in a browser — nodes clickable, panel updates.
- Grounding: if traced, names/interfaces/`file:line` are real; if conceptual, faithful to prose.

## Quality bar

- **Boundaries earn their place** — subgraphs reflect real systems/layers, not decoration.
- **Edges are typed** — every dependency says what it is (calls/reads/publishes).
- **One critical component** highlighted (`:::crit`).
- **Clickable depth** — each panel adds responsibility/interface/deps, not a label echo.

See `references/components.md` for syntax, the `STEPS` format, and the SRI update procedure.
```

- [ ] **Step 2: Write `references/components.md`**

Author a guide mirroring flowchart's `references/components.md` structure but for component diagrams. It MUST cover: the `flowchart LR` + `subgraph` syntax; the rule "rectangles only, no diamonds, no exotic shapes"; the **four escaping rules copied from flowchart** (`( ) { } [ ] "` → `#NN;`; `<br/>` not `\n`; no `&#NN;`; ASCII-only edge labels); typed-edge conventions (`-->|calls|`, `-.->|publishes|`); the `STEPS` panel shape (responsibility/interface/deps); the SRI update procedure (copy flowchart's `curl … openssl` block verbatim); and the verify checklist (run `validate.mjs`). Keep it lean — load-on-demand reference, not duplicated SKILL.md prose.

- [ ] **Step 3: Verify frontmatter name matches directory**

Run:
```bash
head -2 plugins/lirbox/skills/component-diagram/SKILL.md | grep 'name: component-diagram'
```
Expected: the `name: component-diagram` line prints.

- [ ] **Step 4: Commit**

```bash
git add plugins/lirbox/skills/component-diagram/SKILL.md plugins/lirbox/skills/component-diagram/references/components.md
git commit -m "feat(component-diagram): SKILL.md + authoring guide"
```

---

### Task 5: Scaffold `sequence-diagram` skill + template (numbered side-list) + clean fixture

**Files:**
- Create: `plugins/lirbox/skills/sequence-diagram/assets/template.html`
- Create: `plugins/lirbox/skills/sequence-diagram/evals/fixtures/clean.html`

**Interfaces:**
- Produces: the sequence HTML output contract consumed by Task 6's validator —
  - exactly one `<pre class="mermaid">` whose first non-comment line is `sequenceDiagram`, with `autonumber`;
  - messages `A->>B: text` / `A-->>B: text` (sync/return); blocks `alt`/`opt`/`loop`/`par`; `note over …`;
  - a `STEPLIST` **array** between `// TEMPLATE-STEPLIST-START/END`, one entry per autonumbered message, exactly one with `crit: true`;
  - `DEFAULT_STEP` an integer index; a `<ol id="steplist">` rendered from `STEPLIST`; NO `click` lines in the mermaid block.

- [ ] **Step 1: Create dirs and copy flowchart's template as the CSS/shell base**

Run:
```bash
mkdir -p plugins/lirbox/skills/sequence-diagram/assets plugins/lirbox/skills/sequence-diagram/evals/fixtures plugins/lirbox/skills/sequence-diagram/evals/floor plugins/lirbox/skills/sequence-diagram/references
cp plugins/lirbox/skills/flowchart/assets/template.html plugins/lirbox/skills/sequence-diagram/assets/template.html
```

- [ ] **Step 2: Replace the top comment, title, and eyebrow**

In `plugins/lirbox/skills/sequence-diagram/assets/template.html`:
- Replace the `<!-- FLOWCHART TEMPLATE … -->` comment with:
```html
<!--
  SEQUENCE-DIAGRAM TEMPLATE — single HTML file. Renders a time-ordered interaction with
  Mermaid (sequenceDiagram + autonumber, loaded from CDN) + a NUMBERED side-list that drives
  a detail panel (Mermaid has no per-message click). NEEDS INTERNET to render.

  HOW TO USE:
  1. Replace the diagram inside <pre class="mermaid"> … </pre> (between TEMPLATE-SEQ markers)
     with the real interaction. Use `sequenceDiagram` + `autonumber`, ->> sync, -->> return,
     alt/opt/loop/par, note over. Line breaks in message text: <br/> only. Both markers gone.
  2. Replace the STEPLIST array (between TEMPLATE-STEPLIST markers) — one entry per autonumbered
     message, in order; exactly one entry has crit:true. Both markers gone.
  3. Replace every {{PLACEHOLDER}}; set DEFAULT_STEP (integer index).
  Keep the <style> block and the Mermaid init/JS wiring intact.
  Syntax guide: references/components.md.
-->
```
- `<title>`: `Sequence — {{TITLE}}`
- eyebrow: `<p class="eyebrow">Sequence · {{PROJECT_OR_SUBSYSTEM}}</p>`
- title/lead placeholders updated to interaction wording.

- [ ] **Step 3: Replace the mermaid graph block with a `sequenceDiagram` (between renamed `%% TEMPLATE-SEQ-START/END` markers)**

Replace the entire `<pre class="mermaid">…</pre>` inner with:
```
%% TEMPLATE-SEQ-START — replace with the real interaction, then delete both markers.
sequenceDiagram
  autonumber
  participant U as User
  participant API as API
  participant DB as Postgres
  U->>API: POST /login
  API->>DB: SELECT user by email
  DB-->>API: row
  alt password ok
    API-->>U: 200 + session
  else bad password
    API-->>U: 401
  end
%% TEMPLATE-SEQ-END
```
Note: NO `click` lines (sequence diagrams can't bind them).

- [ ] **Step 4: Replace the `<aside>` contents — detail panel + numbered step list**

Replace the `<aside>…</aside>` block with:
```html
  <aside>
    <div class="detail" id="detail">
      <p class="lbl">Step detail</p>
      <h3 id="d-title">—</h3>
      <div class="meta" id="d-meta"></div>
      <div id="d-body"></div>
      <p class="hint">Click a numbered step to inspect it.</p>
    </div>

    <div class="legend">
      <p class="lbl">Steps</p>
      <ol id="steplist" class="steplist"></ol>
    </div>
  </aside>
```

- [ ] **Step 5: Add side-list styles to the `<style>` block**

Append inside `<style>` (before `</style>`):
```css
  .steplist{margin:0;padding-left:0;list-style:none;counter-reset:s}
  .steplist li{counter-increment:s;margin:0 0 4px}
  .steplist li button{all:unset;cursor:pointer;display:block;width:100%;font-size:13px;
    color:var(--slate-soft);padding:6px 8px;border-radius:8px;line-height:1.4}
  .steplist li button::before{content:counter(s)". ";font-family:var(--mono);color:var(--muted)}
  .steplist li button:hover{background:var(--line-soft)}
  .steplist li.active button{background:var(--oat-soft);color:var(--slate)}
  .steplist li.crit button::after{content:" ●";color:var(--clay)}
```

- [ ] **Step 6: Replace the `<script>` JS wiring (STEPS→STEPLIST, selectStep, renderSteps)**

Replace the `const STEPS = {…}` through `mermaid.run(...)` block with:
```js
  // One entry per autonumbered message, in order. body/code are HTML (escape <,>,& in prose).
  const STEPLIST = [
    // TEMPLATE-STEPLIST-START — replace with one entry per message, then delete both markers.
    { title: "User submits credentials", from: "User", to: "API", kind: "sync", meta: ["POST /login"],
      body: "<p>The login form posts email + password.</p>" },
    { title: "Look up the user", from: "API", to: "Postgres", kind: "sync", crit: true, meta: ["SELECT"],
      body: "<p>The load-bearing read — the trust decision hinges on this row.</p>",
      code: "<pre><span class='kw'>SELECT</span> id, pw_hash <span class='kw'>FROM</span> users <span class='kw'>WHERE</span> email = $1</pre>" },
    { title: "Row returned", from: "Postgres", to: "API", kind: "return", meta: ["row"],
      body: "<p>The user record (or none) comes back.</p>" },
    { title: "Session issued / rejected", from: "API", to: "User", kind: "return", meta: ["200 / 401"],
      body: "<p>On match: 200 + session cookie. On mismatch: 401.</p>" },
    // TEMPLATE-STEPLIST-END
  ];
  const DEFAULT_STEP = 0;

  function selectStep(i){
    const s = STEPLIST[i]; if(!s) return;
    document.getElementById('d-title').textContent = s.title;
    const chips = [ (s.from && s.to) ? `${s.from} → ${s.to}` : null, s.kind, ...(s.meta||[]) ].filter(Boolean);
    document.getElementById('d-meta').innerHTML = chips.map(m=>`<span class="tag">${m}</span>`).join('');
    document.getElementById('d-body').innerHTML = (s.body||'') + (s.code||'');
    document.querySelectorAll('#steplist li').forEach((li,j)=>li.classList.toggle('active', j===i));
  }
  function renderSteps(){
    const ol = document.getElementById('steplist');
    ol.innerHTML = STEPLIST.map((s,i)=>`<li${s.crit?' class="crit"':''}><button data-i="${i}">${s.title}</button></li>`).join('');
    ol.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>selectStep(+b.dataset.i)));
  }
  window.selectStep = selectStep;

  mermaid.initialize({ startOnLoad:false, securityLevel:'loose', theme:'base',
    themeVariables:{ fontFamily:'-apple-system,Segoe UI,Roboto,sans-serif', primaryColor:'#FFFFFF',
      primaryBorderColor:'#E7E4DC', primaryTextColor:'#141413', lineColor:'#9A968C',
      secondaryColor:'#F3EFE6', tertiaryColor:'#FAF9F5', actorBkg:'#FFFFFF', actorBorder:'#E7E4DC',
      noteBkgColor:'#F3EFE6', noteBorderColor:'#E3DACC' } });
  mermaid.run({ querySelector:'.mermaid' }).then(()=>{ renderSteps(); selectStep(DEFAULT_STEP); });
```

- [ ] **Step 7: Sanity-grep the template**

Run:
```bash
grep -c 'integrity=' plugins/lirbox/skills/sequence-diagram/assets/template.html
grep -c 'STEPLIST\|selectStep\|renderSteps' plugins/lirbox/skills/sequence-diagram/assets/template.html
grep -c 'click .* selectNode' plugins/lirbox/skills/sequence-diagram/assets/template.html
```
Expected: `1` (SRI), `≥4` (new wiring present), `0` (no flowchart-style click lines).

- [ ] **Step 8: Create the clean fixture**

Run:
```bash
cp plugins/lirbox/skills/sequence-diagram/assets/template.html plugins/lirbox/skills/sequence-diagram/evals/fixtures/clean.html
```
Edit the fixture: delete the 2 `%% TEMPLATE-SEQ-*` lines and the 2 `// TEMPLATE-STEPLIST-*` lines, replace every `{{…}}` with real text. Zero `{{`, zero `TEMPLATE-` remain.

- [ ] **Step 9: Confirm fixture clean**

Run:
```bash
grep -c '{{\|TEMPLATE-' plugins/lirbox/skills/sequence-diagram/evals/fixtures/clean.html
```
Expected: `0`.

- [ ] **Step 10: Commit**

```bash
git add plugins/lirbox/skills/sequence-diagram/assets/template.html plugins/lirbox/skills/sequence-diagram/evals/fixtures/clean.html
git commit -m "feat(sequence-diagram): template (numbered side-list) + clean fixture"
```

---

### Task 6: `sequence-diagram` validator (TDD against fixtures)

**Files:**
- Create: `plugins/lirbox/skills/sequence-diagram/assets/validate.mjs`
- Create: `plugins/lirbox/skills/sequence-diagram/evals/fixtures/no-autonumber.html` (broken)
- Create: `plugins/lirbox/skills/sequence-diagram/evals/fixtures/parity.html` (broken — message/STEPLIST count mismatch)
- Create: `plugins/lirbox/skills/sequence-diagram/evals/fixtures/literal-newline.html` (broken — `\n` in message text)

**Interfaces:**
- Consumes: the clean fixture from Task 5.
- Produces: `validate.mjs`, CLI `node validate.mjs <file.html> …` (defaults to `./*-sequence.html`). Exit 0 iff all checks pass.

**Heuristics this validator uses (documented, deliberately tolerant):**
- **Message line:** a non-structural mermaid line matching an arrow token (`->>`, `-->>`, `->`, `-->`, `-x`, `--x`, `-)`, `--)`) between two participant tokens followed by `:`. Lines starting with a block keyword (`participant`, `actor`, `note`, `alt`, `else`, `opt`, `loop`, `par`, `and`, `end`, `rect`, `activate`, `deactivate`, `autonumber`, `title`, `box`, `critical`, `break`) are NOT messages.
- **STEPLIST length:** counted as the number of `title:` keys inside the `STEPLIST = [ … ]` block.
- Participants are NOT required to be declared (Mermaid auto-creates them from messages) — so the validator does **not** check declaration.

- [ ] **Step 1: Write the three broken fixtures FIRST**

`no-autonumber.html` — copy `clean.html`, delete the `autonumber` line.
`parity.html` — copy `clean.html`, delete ONE message line from the mermaid block (so messages = STEPLIST−1) WITHOUT removing a STEPLIST entry.
`literal-newline.html` — copy `clean.html`, change one message text to embed a literal `\n`, e.g. `U->>API: POST /login\nwith body`.

- [ ] **Step 2: Run the missing validator to confirm RED**

Run:
```bash
node plugins/lirbox/skills/sequence-diagram/assets/validate.mjs plugins/lirbox/skills/sequence-diagram/evals/fixtures/no-autonumber.html
```
Expected: FAIL — `Cannot find module …/validate.mjs`.

- [ ] **Step 3: Implement `validate.mjs`**

```js
#!/usr/bin/env node
// Headless static validator for sequence-diagram output. Zero deps (node:fs).
// Checks: one mermaid block that is a sequenceDiagram with autonumber; message↔STEPLIST
// parity (count match); DEFAULT_STEP in range; exactly one crit step; no literal "\n" or ";"
// in message text (known render-breakers — escape with <br/>, avoid ";"); SRI intact; no
// leftover template markers/placeholders. Heuristics documented in the plan/components.md.
// Usage: node validate.mjs <file.html> [more…]   (defaults to ./*-sequence.html)
import { readFileSync, readdirSync } from 'node:fs';

const BLOCK_KW = /^(participant|actor|note|alt|else|opt|loop|par|and|end|rect|activate|deactivate|autonumber|title|box|critical|break)\b/;
const ARROW = /^\s*[\w"']+\s*(?:--?(?:>>|>|\)|x))\s*[+-]?[\w"']+\s*:(.*)$/;

function mermaidBlocks(html) {
  const re = /<pre[^>]*class=["'][^"']*\bmermaid\b[^"']*["'][^>]*>([\s\S]*?)<\/pre>/gi;
  const out = []; let m;
  while ((m = re.exec(html))) out.push({ text: m[1], startLine: html.slice(0, m.index).split('\n').length });
  return out;
}

function validateFile(file) {
  let html;
  try { html = readFileSync(file, 'utf8'); } catch (e) { return [{ line: 0, msg: `cannot read: ${e.message}` }]; }
  const findings = [];
  const push = (line, msg, snippet) => findings.push({ line, msg, snippet });

  if (/\{\{/.test(html)) push(0, 'leftover {{…}} placeholder');
  if (/TEMPLATE-(SEQ|STEPLIST)/.test(html)) push(0, 'leftover TEMPLATE-* marker — delete markers in generated output');
  if (!/integrity=/.test(html) || !/crossorigin/.test(html)) push(0, 'Mermaid <script> is missing integrity/crossorigin (SRI)');

  const blocks = mermaidBlocks(html);
  if (blocks.length === 0) return [...findings, { line: 0, msg: 'no <pre class="mermaid"> block found' }];
  if (blocks.length > 1) push(blocks[1].startLine, `expected one mermaid block, found ${blocks.length}`);

  const b = blocks[0];
  const lines = b.text.split('\n');
  if (!/^\s*sequenceDiagram\b/m.test(b.text)) push(b.startLine, 'mermaid block is not a sequenceDiagram');
  if (!/^\s*autonumber\b/m.test(b.text)) push(b.startLine, 'no autonumber — the numbered side-list needs it');

  let msgCount = 0;
  lines.forEach((raw, i) => {
    const t = raw.trim();
    const line = b.startLine + i;
    if (t === '' || t.startsWith('%%') || BLOCK_KW.test(t)) return;
    const mm = t.match(ARROW);
    if (mm) {
      msgCount++;
      const text = mm[1];
      if (text.includes('\\n')) push(line, 'literal "\\n" in message text — use <br/>', t);
      if (text.includes(';')) push(line, '";" in message text — Mermaid may treat it as a separator; remove it', t);
    }
  });
  if (msgCount === 0) push(b.startLine, 'no messages found in the sequenceDiagram');

  // STEPLIST parity (count title: keys in the STEPLIST array)
  const listBlock = (html.match(/const\s+STEPLIST\s*=\s*\[([\s\S]*?)\];/) || [, ''])[1];
  const stepCount = (listBlock.match(/\btitle\s*:/g) || []).length;
  if (stepCount !== msgCount) push(0, `STEPLIST has ${stepCount} entries but the diagram has ${msgCount} messages — they must match 1:1`);
  const critCount = (listBlock.match(/\bcrit\s*:\s*true\b/g) || []).length;
  if (critCount !== 1) push(0, `expected exactly one STEPLIST entry with crit:true, found ${critCount}`);
  const defM = html.match(/const\s+DEFAULT_STEP\s*=\s*(\d+)/);
  const def = defM ? Number(defM[1]) : NaN;
  if (!(def >= 0 && def < stepCount)) push(0, `DEFAULT_STEP ${defM ? def : '(unset)'} out of range [0, ${stepCount})`);

  return findings;
}

let files = process.argv.slice(2);
if (files.length === 0) { try { files = readdirSync('.').filter((f) => f.endsWith('-sequence.html')); } catch { files = []; } }
if (files.length === 0) { console.error('validate.mjs: no files given and no *-sequence.html in cwd'); process.exit(1); }

let total = 0;
for (const file of files) {
  const findings = validateFile(file);
  if (findings.length === 0) { console.log(`PASS  ${file}`); continue; }
  total += findings.length;
  console.log(`FAIL  ${file}  (${findings.length})`);
  for (const f of findings) { console.log(`  ${file}:${f.line}  ${f.msg}`); if (f.snippet) console.log(`        ${f.snippet}`); }
}
if (total > 0) { console.error(`\n${total} finding(s) across ${files.length} file(s).`); process.exit(1); }
console.log(`\nAll ${files.length} file(s) clean.`);
```

- [ ] **Step 4: Run the validator against all fixtures**

Run:
```bash
node plugins/lirbox/skills/sequence-diagram/assets/validate.mjs plugins/lirbox/skills/sequence-diagram/evals/fixtures/clean.html
node plugins/lirbox/skills/sequence-diagram/assets/validate.mjs plugins/lirbox/skills/sequence-diagram/evals/fixtures/no-autonumber.html; echo "exit=$?"
node plugins/lirbox/skills/sequence-diagram/assets/validate.mjs plugins/lirbox/skills/sequence-diagram/evals/fixtures/parity.html; echo "exit=$?"
node plugins/lirbox/skills/sequence-diagram/assets/validate.mjs plugins/lirbox/skills/sequence-diagram/evals/fixtures/literal-newline.html; echo "exit=$?"
```
Expected: `PASS  …/clean.html`; then three `FAIL` blocks (`no-autonumber` → "no autonumber …"; `parity` → "STEPLIST has N entries but the diagram has N-1 messages …"; `literal-newline` → "literal \"\\n\" in message text …"), each `exit=1`.

Note: if `clean.html` does NOT pass (e.g. the ARROW heuristic miscounts the `alt`/`else` branch messages), fix the heuristic until the real clean fixture passes — the clean fixture is ground truth.

- [ ] **Step 5: Commit**

```bash
git add plugins/lirbox/skills/sequence-diagram/assets/validate.mjs plugins/lirbox/skills/sequence-diagram/evals/fixtures/no-autonumber.html plugins/lirbox/skills/sequence-diagram/evals/fixtures/parity.html plugins/lirbox/skills/sequence-diagram/evals/fixtures/literal-newline.html
git commit -m "feat(sequence-diagram): headless validator + broken fixtures"
```

---

### Task 7: `sequence-diagram` evals floor

**Files:**
- Create: `plugins/lirbox/skills/sequence-diagram/evals/floor/structure.test.mjs`
- Create: `plugins/lirbox/skills/sequence-diagram/evals/run.mjs`

- [ ] **Step 1: Write the floor characterization test**

Create `evals/floor/structure.test.mjs` (same shape as Task 3's, different assertions):
```js
// FLOOR (characterization) — PASSES on the committed baseline. Locked (evals/**).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE = join(HERE, '..', '..', 'assets', 'validate.mjs');
const FIX = (n) => join(HERE, '..', 'fixtures', n);
function validateExit(fixture) {
  try { execFileSync('node', [VALIDATE, FIX(fixture)], { stdio: 'pipe' }); return 0; }
  catch (e) { return typeof e.status === 'number' ? e.status : 1; }
}
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log(`PASS floor: ${msg}`); else { console.error(`FAIL floor: ${msg}`); failures++; } };

ok(validateExit('clean.html') === 0, 'a clean sequence diagram passes (exit 0)');
ok(validateExit('no-autonumber.html') === 1, 'a missing autonumber is flagged (exit 1)');
ok(validateExit('parity.html') === 1, 'a message/STEPLIST count mismatch is flagged (exit 1)');
ok(validateExit('literal-newline.html') === 1, 'a literal \\n in message text is flagged (exit 1)');

if (failures) { console.error(`\n${failures} floor check(s) FAILED`); process.exit(1); }
console.log('\nfloor: sequence structure characterization green.');
```

- [ ] **Step 2: Write the floor runner**

```bash
cp plugins/lirbox/skills/flowchart/evals/run.mjs plugins/lirbox/skills/sequence-diagram/evals/run.mjs
```
Edit the header-comment path reference to `…/sequence-diagram/evals/run.mjs`.

- [ ] **Step 3: Run the floor**

Run:
```bash
node plugins/lirbox/skills/sequence-diagram/evals/run.mjs
```
Expected: `floor PASS  structure.test.mjs` then `FLOOR GREEN: 1/1 floor test(s) passed.`

- [ ] **Step 4: Commit**

```bash
git add plugins/lirbox/skills/sequence-diagram/evals/floor/structure.test.mjs plugins/lirbox/skills/sequence-diagram/evals/run.mjs
git commit -m "feat(sequence-diagram): evals floor (characterization + runner)"
```

---

### Task 8: `sequence-diagram` SKILL.md + components.md

**Files:**
- Create: `plugins/lirbox/skills/sequence-diagram/SKILL.md`
- Create: `plugins/lirbox/skills/sequence-diagram/references/components.md`

- [ ] **Step 1: Write `SKILL.md`**

```markdown
---
name: sequence-diagram
description: This skill should be used to draw a TIME-ORDERED INTERACTION between actors/services as a self-contained interactive HTML sequence diagram — a Mermaid sequenceDiagram (autonumbered messages, sync/return arrows, alt/opt/loop, notes) paired with a NUMBERED step list that drives a clickable detail panel (who→who, sync/async, narrative, code at the real call site). Triggers when the user asks to "make a sequence diagram", "show the request/login/checkout flow over time", "diagram the message exchange between services", "who calls whom and in what order". For static structure use component-diagram; for a branching process with decisions use flowchart; for one traced code path use codewalk.

# NOTE: output loads Mermaid from a CDN, so the page needs internet to render.
---

# sequence-diagram

Turn a time-ordered interaction into one self-contained interactive HTML page: a Mermaid
`sequenceDiagram` (autonumbered) beside a **numbered step list** that drives a detail panel.
Mermaid can't bind clicks to individual messages, so the numbered list — not the SVG — is the
interactive surface. Warm editorial design shared with the other lirbox HTML skills.

**Offline caveat:** the page fetches Mermaid from a CDN (pinned + SRI). It needs internet to
render — mention this when delivering.

## When to use

Use it for **interaction over time** — request flows, auth handshakes, checkout, inter-service
message exchange. NOT for static structure (use `component-diagram`) or a branching process
with decisions (use `flowchart`).

## Inputs

- An **interaction** to trace — from prose, or from a real repo. If tracing, the messages and
  any `code` at the call site must be real (read the files). Invent nothing.

## Workflow

### 1. Order the messages
List the participants and the messages between them in order: who initiates, sync call vs
async/return, any `alt`/`opt`/`loop` blocks, and notes. Identify the **one critical step**
(the trust-boundary crossing / irreversible write).

### 2. Write the diagram + step list
Read `references/components.md` (sequence syntax, escaping, the `STEPLIST` shape). Copy
`assets/template.html`, then: replace the diagram between `TEMPLATE-SEQ` (keep `autonumber`),
replace the `STEPLIST` array between `TEMPLATE-STEPLIST` (**one entry per autonumbered message,
in order; exactly one `crit:true`**), fill `{{…}}`, set `DEFAULT_STEP`. Keep `<style>` + wiring.
Line breaks in message text: `<br/>` only; avoid `;`. Default output: `./<slug>-sequence.html`.

### 3. Verify before claiming done
- **Run the validator — the headless gate:** `node <skill-dir>/assets/validate.mjs <output>.html`
  must print `PASS` / exit 0. It checks: it's a `sequenceDiagram` with `autonumber`; every
  autonumbered message has exactly one `STEPLIST` entry (1:1 count); one `crit:true`;
  `DEFAULT_STEP` in range; no literal `\n`/`;` in message text; SRI intact; no leftover markers.
- Both marker pairs removed; zero `{{…}}`.
- Optional (needs internet): open in a browser — numbered steps clickable, panel updates,
  Mermaid renders with no parse error.
- Grounding: if traced, messages/`code`/`file:line` are real; if conceptual, faithful to prose.

## Quality bar

- **Order is the story** — messages read top-to-bottom as the real sequence; branches use
  `alt`/`opt`, not separate diagrams.
- **One critical step** marked (`crit:true`) — the trust boundary / irreversible action.
- **Clickable depth** — each step's panel adds who→who, sync/async, and real narrative, not a
  label echo.

See `references/components.md` for sequence syntax, escaping, the `STEPLIST` format, and the
SRI update procedure.
```

- [ ] **Step 2: Write `references/components.md`**

Author a sequence-specific guide covering: `sequenceDiagram` + `autonumber`; participant/actor declaration (optional — controls order only; undeclared participants are auto-created, so the validator does NOT require declaration); arrow vocabulary (`->>` sync, `-->>` return/async, activations `+`/`-`); `alt`/`else`/`opt`/`loop`/`par`/`note over`; **escaping** (message text line breaks = `<br/>` only; avoid `;`; HTML-escape `< > &`); the `STEPLIST` array shape (one entry per autonumbered message, `from`/`to`/`kind`/`meta`/`body`/`code`, exactly one `crit:true`) and how it maps 1:1 to the diagram's numbers; the SRI update procedure (copy flowchart's `curl … openssl` block); and the verify checklist. State clearly that the message↔STEPLIST 1:1 mapping is what the numbered list relies on. Keep it lean.

- [ ] **Step 3: Verify frontmatter name**

Run:
```bash
head -2 plugins/lirbox/skills/sequence-diagram/SKILL.md | grep 'name: sequence-diagram'
```
Expected: prints the line.

- [ ] **Step 4: Commit**

```bash
git add plugins/lirbox/skills/sequence-diagram/SKILL.md plugins/lirbox/skills/sequence-diagram/references/components.md
git commit -m "feat(sequence-diagram): SKILL.md + authoring guide"
```

---

### Task 9: Repo wiring — `.gitignore`, README, CONTRIBUTING, plugin validation

**Files:**
- Modify: `.gitignore:20-23`
- Modify: `README.md:12-21` (skill table) and `README.md:44-58` (usage + namespace line)
- Modify: `CLAUDE.md` (HTML-artifact skills list) — only if it enumerates the skills

**Interfaces:**
- Consumes: both finished skills.
- Produces: a marketplace that passes `claude plugin validate .` and documents both skills.

- [ ] **Step 1: Add the generated-artifact globs to `.gitignore`**

Edit `.gitignore`, in the "Generated single-file HTML artifacts" block (currently lines 20-23), add two lines so it reads:
```
# Generated single-file HTML artifacts (flowchart / codewalk / plan-deck / component / sequence skills)
*-flowchart.html
*-codewalk.html
*-plan-deck.html
*-component.html
*-sequence.html
```
(These must stay ABOVE the `!docs/changes/` re-include lines.)

- [ ] **Step 2: Add two rows to the README skill table**

After the `flowchart` row (`README.md:17`), insert:
```markdown
| **`component-diagram`** | Draw a system's static structure as a self-contained interactive HTML component diagram — Mermaid flowchart with subgraph boundaries + typed dependency edges + a clickable per-component panel (responsibility / interface / deps). Note: renders via a CDN, so this one needs internet. |
| **`sequence-diagram`** | Draw a time-ordered interaction as a self-contained interactive HTML sequence diagram — Mermaid sequenceDiagram (autonumbered) + a numbered step list driving a clickable detail panel (who→who, sync/async, code at the call site). Note: renders via a CDN, so this one needs internet. |
```

- [ ] **Step 3: Update the README usage block and namespace line**

In the `## Install` usage fence (around `README.md:51`), add after the flowchart line:
```text
diagram the components of <service>  # component-diagram
sequence-diagram the login flow      # sequence-diagram
```
In the namespace sentence (`README.md:58`), add `lirbox:component-diagram`, `lirbox:sequence-diagram` to the parenthesized list.

- [ ] **Step 4: Update `CLAUDE.md` HTML-artifact skills list if present**

`CLAUDE.md` lists HTML-artifact skills as "(`codewalk`, `flowchart`, `plan-deck`, `pr-writeup`)". Add `component-diagram` and `sequence-diagram` to that enumeration (one edit, in the "Two skill families" section).

- [ ] **Step 5: Validate the marketplace**

Run:
```bash
claude plugin validate .
```
Expected: passes (no schema errors); both new skills auto-discovered.

- [ ] **Step 6: Run BOTH evals floors as a final regression net**

Run:
```bash
node plugins/lirbox/skills/component-diagram/evals/run.mjs
node plugins/lirbox/skills/sequence-diagram/evals/run.mjs
```
Expected: both print `FLOOR GREEN: 1/1 …`.

- [ ] **Step 7: Commit**

```bash
git add .gitignore README.md CLAUDE.md
git commit -m "docs(lirbox): list + ignore component-diagram & sequence-diagram"
```

---

### Task 10: End-to-end smoke test + empirical sequence-escaping pass

**Files:**
- None committed (generated samples are gitignored). This task is verification + (if needed) a follow-up validator/components.md hardening commit.

**Interfaces:**
- Consumes: both finished skills.
- Produces: confidence that a real generated artifact passes the validator AND renders in a browser; any newly-discovered sequence render-breaker codified into `validate.mjs` + a fixture.

- [ ] **Step 1: Generate one real component diagram from this repo**

Using the `component-diagram` skill's own workflow, produce `lirbox-component.html` mapping a small real slice (e.g. the lirbox skill families: HTML-artifact skills vs orchestration skills as two subgraphs, with the validators/generators as components). Read the real files so labels are accurate.

- [ ] **Step 2: Validate it**

Run:
```bash
node plugins/lirbox/skills/component-diagram/assets/validate.mjs lirbox-component.html
```
Expected: `PASS`. Fix labels until clean.

- [ ] **Step 3: Generate one real sequence diagram**

Produce `conductor-sequence.html` tracing a real ordered interaction (e.g. the conductor phase→checkpoint→worker message order, from the conductor skill). Read the files.

- [ ] **Step 4: Validate it**

Run:
```bash
node plugins/lirbox/skills/sequence-diagram/assets/validate.mjs conductor-sequence.html
```
Expected: `PASS`. Fix until clean.

- [ ] **Step 5: Browser render check (needs internet)**

Open both generated files in a browser (or use the Claude-in-Chrome tools). Confirm for each: Mermaid renders with NO parse/`btoa` error in the console; the panel populates on load; clicking a node (component) / numbered step (sequence) updates the panel. If a sequence message text breaks the render in a way the validator did NOT catch, this is the empirical-discovery moment:

- [ ] **Step 6: Codify any newly-found sequence render-breaker**

If Step 5 surfaced a message/note construct that breaks Mermaid but passed `validate.mjs`: add the rule to `sequence-diagram/assets/validate.mjs`, add a matching broken fixture under `evals/fixtures/`, add a `floor` assertion, re-run the floor, and commit:
```bash
git add plugins/lirbox/skills/sequence-diagram/assets/validate.mjs plugins/lirbox/skills/sequence-diagram/evals/
git commit -m "fix(sequence-diagram): codify <breaker> render rule from smoke test"
```
If Step 5 found nothing new, note that in the PR description and skip the commit.

- [ ] **Step 7: Clean up generated samples**

Run:
```bash
rm -f lirbox-component.html conductor-sequence.html
git status --short
```
Expected: no `*-component.html`/`*-sequence.html` showing as untracked (they're gitignored); working tree clean.

---

## Self-Review

**1. Spec coverage:**
- Two separate skills, self-contained, flowchart-modeled → Tasks 1–4 (component), 5–8 (sequence). ✓
- Grounding both code-traced + conceptual → SKILL.md workflow §1/§3 + Task 10 smoke. ✓
- Component = subgraph flowchart, per-node click, no diamonds → Task 1 graph + Task 2 validator (diamond + subgraph checks). ✓
- Sequence = autonumber + numbered side-list (no SVG click) → Task 5 wiring + Task 6 parity check. ✓
- Headless validator per skill → Tasks 2, 6. ✓
- Minimal evals floor per skill → Tasks 3, 7. ✓
- references/components.md per skill → Tasks 4, 8. ✓
- Non-offline caveat stated → SKILL.md (both) + README rows. ✓
- README + CONTRIBUTING + .gitignore wiring → Task 9. (CONTRIBUTING section A is generic "add a skill" — no per-skill list to edit; verified, no change needed there. README + .gitignore + CLAUDE.md do change.) ✓
- `claude plugin validate .` passes → Task 9 step 5. ✓
- Spec's two deliberate corrections recorded: (a) participant-declaration check dropped (Mermaid auto-creates) — Task 6 heuristics note; (b) component uses rectangles only, reusing flowchart's escaping checker — Task 1 interface + Task 2 reuse. ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases". The "{{…}}" strings are template placeholders the skill fills at runtime (correct), and fixtures must contain zero of them (Tasks 1/5 assert this). Task 10 Step 6 is conditional, not a placeholder. ✓

**3. Type/name consistency:** `selectNode`/`STEPS`/`DEFAULT_NODE` (component, inherited from flowchart) vs `selectStep`/`STEPLIST`/`DEFAULT_STEP`/`renderSteps` (sequence) — used consistently across template, validator regexes, and SKILL.md in each skill. Validator output contract (`PASS`/exit 0, `FAIL`/exit 1) consistent across both and matches the floor tests' `validateExit`. Fixture filenames match between creation steps, validator invocations, and floor assertions. ✓

## Open follow-ups (NOT in this plan's scope)
- Shared `_shared/escape-lint.mjs` to de-duplicate the escaping checker across flowchart + component (spec tradeoff 1).
- `whetstone` feedback backlog (`feedback/*.jsonl`) for either skill — added when concerns are filed, not at creation.

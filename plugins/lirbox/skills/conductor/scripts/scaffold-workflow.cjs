#!/usr/bin/env node
/*
 * Deterministically generate a conductor conductor from params.
 * Replaces "copy a template and hope the LLM fills it correctly" — all the mechanical
 * boilerplate (NAME/STATE/BRANCH consts, checkpoint() with startedAt-preserving merge,
 * Setup worktree+node_modules, resume guards, optional Brief/PR/TicketUpdate, finalize)
 * is emitted here. The work-phase prompts are passed in as DATA (--prompt/--prompts-file),
 * so the caller never reads back or hand-edits the generated script. The FIXED worker-prompt
 * prose is data too: plain template files under scripts/prompts/, loaded at generation time
 * (emitted-runtime text verbatim + {{NAME}} placeholders for generator-computed fragments).
 *
 * Usage:
 *   node scaffold-workflow.cjs --name <slug> [options]
 * Options:
 *   --name <slug>        required; drives state/branch/worktree paths
 *   --phases <a,b,c>     work phase titles (default: "Work")
 *   --independent        declare the work items INDEPENDENT: fan them out concurrently in ONE
 *                        Work phase via parallel() (one worker per item) instead of N sequential
 *                        phases, so wide decomposable tasks don't pay N× worker spin-up +
 *                        per-item verification. Downstream gates still verify the combined diff
 *                        once. Reserve sequential --phases for genuinely dependent steps.
 *   --prompt <text>      prompt for the sole work phase (data-in; errors if >1 work phase)
 *   --prompts-file <j>   JSON { "<PhaseTitle>": "<prompt>" } filling work-phase prompts from data
 *   --desc <text>        meta.description (default derived from name)
 *   --base <ref>         worktree branch point (default: remote's default branch, fetched fresh)
 *   --ticket             include Brief (fetch ticket) + TicketUpdate phases
 *   --pr                 include a PR phase (push branch + gh pr create)
 *   --merge-gates        collapse CodeGate + TestGate into ONE Review phase (fewer steps)
 *   --writeup            add a Writeup phase (promote implementation-notes + pr-writeup HTML +
 *                        design diagram, committed under docs/changes/<name>/). Default ON when a
 *                        PR phase exists; --no-writeup opts out.
 *   --dod-file <json>    { criteria: [{ id, text, tier: checkable|judged, check? }] } — the
 *                        definition of done, frozen in as DATA; emits DoDBaseline + DoDGate.
 *                        REQUIRED under --profile lite/delivery (or pass --no-dod).
 *   --no-dod             suppress the DoD gate (explicit opt-out, even under a profile)
 *   --review-panel       multi-dimension panel CodeGate (parallel reviewers + confidence filter
 *                        + lead fixer). Default ON under --profile delivery.
 *   --no-review-panel    keep the single review+fix CodeGate agent even under delivery
 *   --frontend <t>       web|mobile|both — add a FrontendGate phase (after the code-quality gate,
 *                        before DoDGate/Writeup): a diff guard skips it when the diff touches no
 *                        UI files; otherwise per-target verifier fix-loop (≤3, hard-fail) writes
 *                        E2E specs + an evidence manifest at implementation-notes/frontend-evidence/
 *                        manifest.json. The engine chain/viewports come from the DoD file's
 *                        "frontend" block as DATA — the generator never probes the machine.
 *   --model-mode <m>     default (inherit session model, no opt emitted) | auto (tier by phase)
 *   --model-think <m>    auto thinking-tier model: sonnet|opus|haiku|fable (default opus)
 *   --model-work <m>     auto work-phase model:    sonnet|opus|haiku|fable (default sonnet)
 *   --profile lite       routine small-task delivery: --ticket --pr --merge-gates, 1 work phase
 *   --profile delivery   full TDD cycle + all gates (--cycle --ticket --pr --enforce-docs)
 *   --out <path>         output file (default: .workflows/<name>.js)
 *   --force              overwrite an existing output file
 */
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true; // bare flag → true
}

// --- Worker-prompt templates: the static prose lives as DATA under scripts/prompts/ ---
// Each template holds the EMITTED text verbatim: dollar-brace expressions and backslash
// sequences in a template belong to the generated script's RUNTIME template literals and pass
// through untouched — there is no generator-escaping layer to fight when editing prose.
// Generator-computed fragments use {{NAME}} placeholders, substituted mechanically here; an
// unfilled placeholder aborts generation loudly instead of emitting a subtly-wrong script.
const PROMPT_DIR = path.join(__dirname, 'prompts');
function promptTpl(file, subs) {
  let text;
  try { text = fs.readFileSync(path.join(PROMPT_DIR, file), 'utf8'); }
  catch (e) { console.error(`ERROR: prompt template scripts/prompts/${file} not readable: ${e.message}`); process.exit(1); }
  if (text.endsWith('\n')) text = text.slice(0, -1); // the file-final newline is not prompt text
  for (const [k, v] of Object.entries(subs || {})) text = text.split('{{' + k + '}}').join(v);
  const unfilled = text.match(/\{\{[A-Z_]+\}\}/);
  if (unfilled) { console.error(`ERROR: prompt template ${file} left placeholder ${unfilled[0]} unfilled`); process.exit(1); }
  return text;
}
// Same, wrapped in the backticks of the emitted runtime template literal (the common case).
const tpl = (file, subs) => '`' + promptTpl(file, subs) + '`';

const name = arg('name');
if (!name || name === true) { console.error('ERROR: --name <slug> is required'); process.exit(1); }
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) { console.error('ERROR: --name must be a kebab slug (a-z0-9-)'); process.exit(1); }

const phases = String(arg('phases', 'Work')).split(',').map((s) => s.trim()).filter(Boolean);
// --independent: the work items share no files/state — fan them out CONCURRENTLY in one Work
// phase (parallel(), one worker per item) instead of N sequential phases. Sequential emission
// stays the default and is reserved for genuinely dependent steps.
const independent = arg('independent', false) === true;
const desc = arg('desc', `Durable workflow: ${name}`);
const base = arg('base', '');
const profile = arg('profile', false);
const profileDelivery = profile === 'delivery';
// `lite`: routine delivery with the gates collapsed into ONE Review phase — fewer steps for
// small/low-risk tasks. = --ticket --pr --merge-gates, single work phase, no full TDD cycle.
const profileLite = profile === 'lite';
const withCycle = profileDelivery || arg('cycle', false) === true;
const withTicket = profileDelivery || profileLite || arg('ticket', false) === true || typeof arg('ticket', false) === 'string';
const withPR = profileDelivery || profileLite || arg('pr', false) === true;
const enforceCode = profileDelivery || arg('enforce-code', false) === true;
const enforceTests = profileDelivery || arg('enforce-tests', false) === true;
const enforceDocs = profileDelivery || arg('enforce-docs', false) === true;
// One combined Review phase (review+fix+build+warranted-tests-green) instead of separate
// CodeGate + TestGate. Implied by --profile lite; ignored under --cycle (the cycle has its own).
const mergeGates = profileLite || arg('merge-gates', false) === true;
// `--writeup`: a Writeup phase (promote implementation-notes + a pr-writeup HTML + a design
// diagram, committed under docs/changes/<name>/ so they ride the PR). Defaults ON whenever a PR
// phase exists ("every PR gets reviewer artifacts"); `--no-writeup` opts out; `--writeup` forces
// it on even without `--pr`.
const withWriteup = (arg('no-writeup', false) === true) ? false : (withPR || arg('writeup', false) === true);
// --- DoD (definition of done) — criteria passed as DATA; verified by a DoDGate phase ---
// --dod-file <json>: { "criteria": [{ "id", "text", "tier": "checkable"|"judged", "check"? }] }
//   Frozen at scaffold time (change = regenerate with --force). Providing the file is the
//   opt-in for bare runs; --profile lite/delivery REQUIRE it (or an explicit --no-dod).
// --no-dod: suppress the DoD gate entirely (explicit escape hatch, even under a profile).
const noDod = arg('no-dod', false) === true;
const dodFileArg = arg('dod-file', '');
let dodCriteria = null;
let dodFrontend = null; // optional "frontend" block (engine chain + viewports) — spliced as DATA
if (dodFileArg && dodFileArg !== true && !noDod) {
  let raw;
  try { raw = fs.readFileSync(dodFileArg, 'utf8'); }
  catch (e) { console.error('ERROR: --dod-file not readable: ' + e.message); process.exit(1); }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { console.error('ERROR: --dod-file is not valid JSON: ' + e.message); process.exit(1); }
  dodCriteria = (parsed && Array.isArray(parsed.criteria)) ? parsed.criteria : null;
  dodFrontend = (parsed && parsed.frontend && typeof parsed.frontend === 'object') ? parsed.frontend : null;
  if (!dodCriteria || !dodCriteria.length) { console.error('ERROR: --dod-file needs a non-empty "criteria" array'); process.exit(1); }
  for (const c of dodCriteria) {
    if (!c.id || !c.text || (c.tier !== 'checkable' && c.tier !== 'judged')) {
      console.error('ERROR: every DoD criterion needs id, text, and tier "checkable"|"judged" — got ' + JSON.stringify(c)); process.exit(1);
    }
    if (c.tier === 'checkable' && (typeof c.check !== 'string' || !c.check.trim())) {
      console.error(`ERROR: checkable DoD criterion '${c.id}' needs a non-empty "check" command`); process.exit(1);
    }
  }
}
if (!noDod && !dodCriteria && (profileLite || profileDelivery)) {
  console.error('ERROR: --profile lite/delivery requires a DoD (--dod-file <json>) — pass --no-dod to opt out explicitly');
  process.exit(1);
}
const withDod = !!dodCriteria;
const dodCheckable = withDod ? dodCriteria.filter((c) => c.tier === 'checkable') : [];

// --- Frontend/mobile verification gate (--frontend web|mobile|both) ---
// Emits a FrontendGate phase AFTER the code-quality gate (CodeGate/ReVerify under --cycle; the
// merged Review phase under lite) and BEFORE DoDGate/Writeup, so DoDGate can cite the evidence
// manifest. The frozen engine chain/viewports travel in the DoD file's "frontend" block as DATA.
const frontendArg = arg('frontend', '');
if (frontendArg === true || (frontendArg && !['web', 'mobile', 'both'].includes(frontendArg))) {
  console.error(`ERROR: --frontend must be 'web', 'mobile' or 'both' (got '${frontendArg === true ? '' : frontendArg}')`);
  process.exit(1);
}
const frontendTargets = frontendArg === 'both' ? ['web', 'mobile'] : (frontendArg ? [frontendArg] : []);
const withFrontend = frontendTargets.length > 0;

// --- Panel code review: parallel dimension reviewers + confidence filter + lead fixer ---
// delivery default ON; --review-panel forces it wherever a CodeGate exists (--enforce-code /
// --cycle); --no-review-panel keeps the single review+fix agent. The collapsed Review phase
// (lite / --merge-gates) ALWAYS stays single-agent — lite is the cheap tier by design.
const reviewPanel = (arg('no-review-panel', false) === true) ? false
  : (profileDelivery || arg('review-panel', false) === true);
if (reviewPanel && !(enforceCode || withCycle)) {
  console.error('WARN: --review-panel has no effect without a CodeGate (--enforce-code or --cycle)');
}

// Panel dimensions (generator-time data). history rides only under --profile delivery.
const PANEL_DIMENSIONS = [
  { key: 'bugs', focus: 'Correctness: shallow-scan the diff itself for real bugs — logic errors, off-by-one, broken contracts, null/undefined misuse. Focus on the changed lines; skip nitpicks a senior engineer would not raise and anything a linter/typechecker would catch.' },
  { key: 'security', focus: 'Security on the CHANGED paths only: injection, missing authz/authn, secrets committed, unsafe deserialization, path traversal, SSRF.' },
  { key: 'reuse', focus: 'Reuse & simplification: duplicated logic, existing helpers/utilities the change should have used, dead code introduced, needless complexity.' },
  { key: 'conventions', focus: 'Conventions: violations of CLAUDE.md guidance (repo root + every directory the diff touches) and of guidance in code comments adjacent to the changes. Cite the exact guidance line for every finding.' },
];
if (profileDelivery) PANEL_DIMENSIONS.push(
  { key: 'history', focus: 'Git history: read git blame/log for the modified code; flag changes that contradict the reason a prior fix was made or reintroduce a previously-fixed bug. Cite the commit.' });

// The /code-review confidence rubric, given to each scorer verbatim.
const CONFIDENCE_RUBRIC = promptTpl('confidence-rubric.txt');

const out = arg('out', path.join('.workflows', name + '.js'));
const force = arg('force', false) === true;

// Agent overrides — default to the bundled lirbox agents, override per gate, or `none` for a
// generic built-in subagent (no agent dependency).
const agentRed = arg('agent-red', 'lirbox:lirbox-test-writer');
const agentCode = arg('agent-code', 'lirbox:lirbox-code-reviewer');
const agentTests = arg('agent-tests', 'lirbox:lirbox-tryve-enhancer');
const agentDocs = arg('agent-docs', 'lirbox:lirbox-docs-writer');
const agentWeb = arg('agent-web', 'lirbox:lirbox-web-verifier');
const agentMobile = arg('agent-mobile', 'lirbox:lirbox-mobile-verifier');
// Emits the `agentType: '...',` fragment, or '' when set to none/empty (→ generic subagent).
const at = (a) => (a && a !== 'none' && a !== true) ? `agentType: '${a}',` : '';

// --- model selection (--model-mode) ---
// default  : emit NO `model:` opt at all → every worker inherits the session model. Output is
//            byte-identical to the pre-mode generator (the backward-compat invariant).
// auto     : tag each agent() call with a `model:` opt by phase CLASS — a cheap model for
//            mechanical/IO work, a strong model for reasoning, the work phases the advisor's call.
const MODEL_VALUES = ['sonnet', 'opus', 'haiku', 'fable'];
const modelMode = arg('model-mode', 'default');
if (modelMode !== 'default' && modelMode !== 'auto') {
  console.error(`ERROR: --model-mode must be 'default' or 'auto' (got '${modelMode}')`); process.exit(1);
}
// In default mode no `model:` opt is emitted, so --model-think/--model-work would be silently
// ignored. Reject them loudly instead of pretending they took effect.
if (modelMode === 'default') {
  for (const flag of ['--model-think', '--model-work']) {
    if (process.argv.includes(flag)) {
      console.error(`ERROR: ${flag} requires --model-mode auto (ignored in default mode)`); process.exit(1);
    }
  }
}
const modelThink = arg('model-think', 'opus');  // thinking-tier model (auto)
const modelWork = arg('model-work', 'sonnet');  // work-phase model (auto; advisor's call)
for (const [flag, val] of [['--model-think', modelThink], ['--model-work', modelWork]]) {
  if (val === true || !MODEL_VALUES.includes(val)) {
    console.error(`ERROR: ${flag} must be one of: ${MODEL_VALUES.join(', ')}`); process.exit(1);
  }
}
// class → model. mechanical: worktree/checkpoint/verify/push/ticket. think: RED, gates, pathgap,
// docs, writeup, brief. work: the --phases tasks.
const MODEL_TIER = { mechanical: 'haiku', think: modelThink, work: modelWork };
// Emits the class opt fragment in auto mode (or '' in default mode, no opt emitted): the
// `model: '<m>',` opt, plus `effort: 'high',` for the think class — reasoning phases get the
// stronger reasoning budget; mechanical/work phases never carry an effort opt.
const mdl = (cls) => (modelMode === 'auto' && MODEL_TIER[cls])
  ? `model: '${MODEL_TIER[cls]}',${cls === 'think' ? " effort: 'high'," : ''}`
  : '';
const mechFrag = mdl('mechanical');  // used by Setup + checkpoint (emitted in the template tail)

// --- work-phase prompts passed as DATA (so the caller never reads/edits the generated script) ---
// --prompt <text>      : prompt for the sole work phase (errors if there are several work phases)
// --prompts-file <json>: { "<PhaseTitle>": "<prompt text>", ... } — fills each work phase's prompt
const promptMap = {};
const promptsFile = arg('prompts-file', '');
if (promptsFile && promptsFile !== true) {
  let raw;
  try { raw = fs.readFileSync(promptsFile, 'utf8'); }
  catch (e) { console.error('ERROR: --prompts-file not readable: ' + e.message); process.exit(1); }
  try { Object.assign(promptMap, JSON.parse(raw)); }
  catch (e) { console.error('ERROR: --prompts-file is not valid JSON: ' + e.message); process.exit(1); }
}
const promptInline = arg('prompt', '');
if (promptInline && promptInline !== true) {
  if (phases.length !== 1) { console.error('ERROR: --prompt needs exactly one work phase; use --prompts-file for multiple'); process.exit(1); }
  promptMap[phases[0]] = promptInline;
}
// --- optional --spec <json>: a superset of the flags allowing per-phase overrides ---
// { "phases": { "<Title>": "<prompt>", "<Title>.schema": "<schema source>", "<Title>.agent": "<id|none>" } }
// Existing flags keep working unchanged; --spec only ADDS per-phase customization for work phases.
const spec = {};
const specFile = arg('spec', '');
if (specFile && specFile !== true) {
  let raw;
  try { raw = fs.readFileSync(specFile, 'utf8'); }
  catch (e) { console.error('ERROR: --spec not readable: ' + e.message); process.exit(1); }
  try { Object.assign(spec, JSON.parse(raw)); }
  catch (e) { console.error('ERROR: --spec is not valid JSON: ' + e.message); process.exit(1); }
}

// Escape so the data text is embedded LITERALLY inside the generated template literal
// (no accidental backtick-close or ${...} interpolation).
const escTpl = (s) => String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

if (fs.existsSync(out) && !force) { console.error(`ERROR: ${out} exists (use --force to overwrite)`); process.exit(1); }

const camel = (s) => s.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ')
  .map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1))).join('');

const SCHEMA = (props, req) =>
  `{ type: 'object', additionalProperties: false, required: ${JSON.stringify(req)}, properties: ${JSON.stringify(props)} }`;

// ============================================================================
// SINGLE SOURCE OF TRUTH: one ordered table of phase descriptors. BOTH the
// meta/phase order AND the emitted code blocks are derived from this list, so
// the two can never drift. Each descriptor: { title, enabledWhen, build(ctx) }.
//   - enabledWhen: boolean — keep this phase for the current flag combo.
//   - build(ctx): returns the emitted block STRING (via the emitPhase/gateLoop
//     helpers below), or an array of {title, src} when it expands to several
//     phases (the work phases). Work phases splice in at their table position.
// Setup is unconditionally first and emitted verbatim in the template tail.
// ============================================================================

let pendingTodos = 0;

// Common skeleton: phase('T') / if(<guard>){log(<resumed>)} else { <body> done.add('T'); checkpoint }.
// `body` is emitted VERBATIM (already indented for the `} else {` block by the builders below) —
// emitPhase must NOT re-indent it, since interior prompt template-literal lines are column-0 and
// whitespace there is significant. `extraGuard` prepends an `if(<cond>){log} else ...` branch.
function emitPhase(title, body, opts = {}) {
  const resumed = opts.resumed || `${title} already complete (resumed)`;
  const head = opts.extraGuard
    ? `if (${opts.extraGuard.cond}) {\n  log('${opts.extraGuard.msg}')\n} else if (done.has('${title}')) {`
    : `if (done.has('${title}')) {`;
  return `
phase('${title}')
${head}
  log('${resumed}')
} else {
${body}
  done.add('${title}')
  await checkpoint('${title}')
}`;
}

// Runtime prompt anchors appended to every gate round (issue #12). Emitted as generated-conductor
// SOURCE — the backticks/${…} below are runtime template literals, NOT generator interpolation.
//   - DOD_DECL: when a Brief captured the goal/AC (results.brief), scope the gate to the task's
//     actual intent so findings don't drift into unrelated changes. Guarded, so non-ticket runs
//     never dereference a missing brief.
//   - CARRY_DECL: on round>1, feed the prior round's result forward so retries CONVERGE (build on
//     what was already found/fixed) instead of re-reviewing the diff from scratch.
// Both are emitted-runtime STATEMENT source, stored verbatim in their template files.
const DOD_DECL = promptTpl('dod-decl.txt');
const CARRY_DECL = promptTpl('carry-decl.txt');

// Explicit output contract for the fix-gates (panel CodeGate lead, single-agent CodeGate, merged
// Review). The generated loop trusts gatePassed alone and its throw message assumes "unresolved"
// semantics, so the prompt must pin both down: what gatePassed=true requires, and that
// critical/high count findings LEFT unresolved (not findings fixed). Plain text only — no
// backticks/${}/backslashes — so it interpolates safely into the emitted template literals.
const GATE_CONTRACT = promptTpl('gate-contract.txt');

// Build-run evidence demanded by the fix-gates (honesty anchor, not a second verifier): the gate
// cannot go green on the honor system — the loop's pass condition rejects gatePassed=true unless
// buildExit is 0, so the agent must actually invoke the build and report the outcome. Plain text
// only (no backticks/${}/backslashes) — it interpolates into the emitted template literals.
const BUILD_EVIDENCE = promptTpl('build-evidence.txt');

// A bounded 3-round gate: run the agent up to 3× until `flag` is truthy, else throw.
// `prompt`/`schema` are template-literal source fragments; `agentFrag` is the optional
// `agentType: '...',` (or '' for a generic subagent). Output is indented for the else-block.
// `dod` (default true) appends the goal/AC scope anchor; set false for non-findings gates.
// `buildEvidence` (default false) also rejects a pass without buildExit === 0 — set true ONLY
// for the fix-gates (CodeGate/Review) whose schemas require buildCmd/buildExit; PathGap shares
// this helper and must stay evidence-free.
function gateLoop({ flag, prompt, schema, agentFrag, modelFrag, label, phase: ph, throwMsg, resultKey, dod = true, buildEvidence = false }) {
  const lead = [agentFrag, modelFrag].filter(Boolean).join(' ');
  const decls = [dod ? '    ' + DOD_DECL : null, '    ' + CARRY_DECL].filter(Boolean).join('\n');
  const apply = dod ? ' + dod + carry' : ' + carry';
  return `  let passed = false, last = null
  for (let round = 1; round <= 3 && !passed; round++) {
${decls}
    last = await agent(
      ${prompt}${apply},
      { label: \`${label}:r\${round}\`, phase: '${ph}',${lead ? ' ' + lead : ''}
        schema: ${schema} },
    )
    passed = last && last.${flag}${buildEvidence ? ' && last.buildExit === 0' : ''}
  }
  if (!passed) throw new Error(${throwMsg})
  results.${resultKey} = last`;
}

// Panel CodeGate body: guard → parallel dimension reviewers (read-only, findings schema) →
// deterministic dedup → per-finding confidence scorers (drop <80) → lead adjudicator+fixer
// loop (≤3, hard-fail). Fan-out lives HERE in the conductor JS — the lead is a worker, never
// a spawner. Output is indented for the emitPhase else-block.
function panelBody() {
  const findingsSchema = SCHEMA({ findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['file', 'line', 'severity', 'title'], properties: { file: { type: 'string' }, line: { type: 'number' }, severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] }, title: { type: 'string' }, detail: { type: 'string' } } } } }, ['findings']);
  return `  // Panel review: guard → parallel dimensions → dedup → confidence filter → lead fixer.
  const guard = await agent(
    ${tpl('panel-guard.txt')},
    { label: 'codegate:guard', phase: 'CodeGate',${mdl('mechanical') ? ' ' + mdl('mechanical') : ''}
      schema: ${SCHEMA({ isCode: { type: 'boolean' }, reason: { type: 'string' } }, ['isCode'])} },
  )
  if (!guard || !guard.isCode) {
    log('CodeGate: not a code change (' + ((guard && guard.reason) || 'no reason') + ') — panel skipped')
    results.codeGate = { gatePassed: true, skipped: true, critical: 0, high: 0, summary: 'skipped: not a code change' }
  } else {
    const DIMENSIONS = ${JSON.stringify(PANEL_DIMENSIONS)}
    const rawResults = await parallel(DIMENSIONS.map((d) => () => agent(
      ${tpl('panel-dimension.txt')},
      { label: 'codegate:' + d.key, phase: 'CodeGate',${mdl('think') ? ' ' + mdl('think') : ''}
        schema: ${findingsSchema} },
    )))
    const all = rawResults.filter(Boolean).flatMap((r) => r.findings || [])
    const seen = new Set()
    const deduped = []
    for (const f of all) {
      const k = (f.file || '') + ':' + (f.line || 0)
      if (!seen.has(k)) { seen.add(k); deduped.push(f) }
    }
    const scored = deduped.length ? await parallel(deduped.map((f, i) => () => agent(
      ${tpl('panel-score.txt', { CONFIDENCE_RUBRIC: escTpl(CONFIDENCE_RUBRIC) })},
      { label: 'codegate:score-' + i, phase: 'CodeGate',${mdl('mechanical') ? ' ' + mdl('mechanical') : ''}
        schema: ${SCHEMA({ score: { type: 'number' }, reason: { type: 'string' } }, ['score'])} },
    ).then((v) => ({ ...f, confidence: v ? v.score : 0 })))) : []
    const confirmed = scored.filter(Boolean).filter((f) => f.confidence >= 80)
    if (!confirmed.length) {
      log('CodeGate panel: 0 of ' + all.length + ' raw findings survived verification — passing')
      results.codeGate = { gatePassed: true, critical: 0, high: 0, summary: 'panel: ' + all.length + ' raw, 0 confirmed', panel: { raw: all.length, deduped: deduped.length, confirmed: 0 } }
    } else {
      let passed = false, last = null
      for (let round = 1; round <= 3 && !passed; round++) {
        ${DOD_DECL}
        ${CARRY_DECL}
        last = await agent(
          ${tpl('panel-lead.txt', { GATE_CONTRACT, BUILD_EVIDENCE })} + dod + carry,
          { label: \`codegate:lead-r\${round}\`, phase: 'CodeGate', ${at(agentCode)}${mdl('think') ? ' ' + mdl('think') : ''}
            schema: ${SCHEMA({ gatePassed: { type: 'boolean' }, critical: { type: 'number' }, high: { type: 'number' }, summary: { type: 'string' }, buildCmd: { type: 'string' }, buildExit: { type: 'number' }, skippedFindings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'reason'], properties: { title: { type: 'string' }, reason: { type: 'string' } } } }, knownOpen: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['file', 'line', 'severity', 'title'], properties: { file: { type: 'string' }, line: { type: 'number' }, severity: { type: 'string' }, title: { type: 'string' } } } } }, ['gatePassed', 'critical', 'high', 'buildCmd', 'buildExit', 'skippedFindings', 'knownOpen'])} },
        )
        passed = last && last.gatePassed && last.buildExit === 0
      }
      if (!passed) throw new Error('CodeGate failed: unresolved Critical/High after 3 rounds — ' + (last && last.summary || ''))
      results.codeGate = { ...last, panel: { raw: all.length, deduped: deduped.length, confirmed: confirmed.length } }
    }
  }`;
}

// FrontendGate body: diff guard → per-target verifier fix-loop (≤3 rounds, hard-fail). The
// verifier agents ship with the plugin; when a typed dispatch fails (agentType unavailable) the
// loop degrades gracefully — same prompt on a generic subagent plus a logged warning — instead
// of hard-failing on the missing agent. The frozen engine chain/viewports are spliced from the
// DoD file's "frontend" block as DATA; the generator never probes the machine. Output is
// indented for the emitPhase else-block.
function frontendBody() {
  const fSchema = SCHEMA({ gatePassed: { type: 'boolean' }, specsWritten: { type: 'number' }, manifest: { type: 'string' }, summary: { type: 'string' } }, ['gatePassed']);
  const chain = escTpl(dodFrontend
    ? JSON.stringify(dodFrontend)
    : 'none frozen in the DoD — detect the engines available in the worktree yourself, prefer repo-native tooling, and record the chain actually used in the manifest');
  const think = mdl('think') ? ' ' + mdl('think') : '';
  const targetBlocks = frontendTargets.map((t) => {
    const agentId = t === 'web' ? agentWeb : agentMobile;
    const typed = agentId && agentId !== 'none' && agentId !== true;
    const resultKey = t === 'web' ? 'frontendGateWeb' : 'frontendGateMobile';
    const dispatch = typed
      ? `try {
          last = await agent(fPrompt + dod + carry,
            { label: \`frontendgate:${t}-r\${round}\`, phase: 'FrontendGate', agentType: '${agentId}',${think}
              schema: ${fSchema} },
          )
        } catch (e) {
          log('FrontendGate: agent ${agentId} unavailable (' + ((e && e.message) || e) + ') — retrying on a generic subagent')
          last = await agent(fPrompt + dod + carry,
            { label: \`frontendgate:${t}-generic-r\${round}\`, phase: 'FrontendGate',${think}
              schema: ${fSchema} },
          )
        }`
      : `last = await agent(fPrompt + dod + carry,
          { label: \`frontendgate:${t}-r\${round}\`, phase: 'FrontendGate',${think}
            schema: ${fSchema} },
        )`;
    return `    // ${t} verifier: fix-loop ≤3 rounds, then hard-fail (standard gate semantics).
    {
      const fPrompt = ${tpl('frontend-verify.txt', { TARGET: t, FRONTEND_CHAIN: chain })}
      let passed = false, last = null
      for (let round = 1; round <= 3 && !passed; round++) {
        ${DOD_DECL}
        ${CARRY_DECL}
        ${dispatch}
        passed = last && last.gatePassed
      }
      if (!passed) throw new Error('FrontendGate (${t}) failed: UI verification not green after 3 rounds — ' + ((last && last.summary) || ''))
      results.${resultKey} = last
    }`;
  });
  return `  // Diff guard: skip the gate when the diff touches no UI files (same pattern as the panel guard).
  const fguard = await agent(
    ${tpl('frontend-guard.txt')},
    { label: 'frontendgate:guard', phase: 'FrontendGate',${mdl('mechanical') ? ' ' + mdl('mechanical') : ''}
      schema: ${SCHEMA({ isUI: { type: 'boolean' }, reason: { type: 'string' } }, ['isUI'])} },
  )
  if (!fguard || !fguard.isUI) {
    log('FrontendGate: diff touches no UI files (' + ((fguard && fguard.reason) || 'no reason') + ') — skipped')
    results.frontendGate = { gatePassed: true, skipped: true, summary: 'skipped: no UI files in diff' }
  } else {
${targetBlocks.join('\n')}
    results.frontendGate = { gatePassed: true, targets: ${JSON.stringify(frontendTargets)} }
  }`;
}

// A single agent call whose result is stored at results[key], with an optional hard-fail check.
// Output is indented for the else-block; interior prompt lines stay column-0.
function agentCall({ key, prompt, schema, agentFrag, modelFrag, label, phase: ph, check }) {
  const lead = [agentFrag, modelFrag].filter(Boolean).join(' ');
  return `  results.${key} = await agent(
    ${prompt},
    { label: '${label}', phase: '${ph}', ${lead ? lead + '\n      ' : ''}schema: ${schema} },
  )${check ? '\n  ' + check : ''}`;
}

// ---- work-phase descriptor: expands to one phase per --phases title (prompts are data-in) ----
// Under --independent it instead expands to ONE 'Work' phase that fans every item out via
// parallel() — one worker per item, per-item spec overrides preserved, gates verify once.
const workItem = (p) => {
  const key = camel(p);
  const provided = (spec.phases && spec.phases[p]) || (promptMap[p] != null ? String(promptMap[p]) : '');
  if (!provided) pendingTodos++;
  const body = provided
    ? escTpl(provided)
    : promptTpl('work-todo.txt', { PHASE: p });
  const greenLine = withCycle ? '\n' + promptTpl('green-line.txt') + '\n' : '';
  const sch = (spec.phases && spec.phases[p] && spec.phases[p + '.schema']) || SCHEMA({ summary: { type: 'string' } }, ['summary']);
  const agentFrag = (spec.phases && spec.phases[p + '.agent']) ? at(spec.phases[p + '.agent']) : '';
  return { p, key, greenLine, body, sch, agentFrag };
};
const workPhasesBuild = () => {
  if (independent) {
    // Sibling workers share ONE worktree — each item's prompt carries the concurrency rules
    // (touch only your files, retry on index.lock, no repo-wide git ops, no full-suite runs).
    const conc = promptTpl('independent-concurrency.txt');
    const items = phases.map(workItem);
    const calls = items.map(({ p, key, greenLine, body, sch, agentFrag }) => {
      const lead = [agentFrag, mdl('work')].filter(Boolean).join(' ');
      return `    () => agent(
      \`\${inWorktree('${p}')}\n\n${conc}\n${greenLine}\n${body}\`,
      { label: '${key}', phase: 'Work',${lead ? ' ' + lead : ''}
        schema: ${sch} },
    ),`;
    });
    const body = `  // Declared-independent work items: fan out CONCURRENTLY — one worker per item,
  // no shared files/state, and the downstream gates verify the combined diff ONCE.
  const workOut = await parallel([
${calls.join('\n')}
  ])
  const workKeys = ${JSON.stringify(items.map((i) => i.key))}
  workOut.forEach((r, i) => { results[workKeys[i]] = r })`;
    return [{ title: 'Work', src: emitPhase('Work', body) }];
  }
  return phases.map((p) => {
    const { key, greenLine, body, sch, agentFrag } = workItem(p);
    const src = emitPhase(p, agentCall({
      key,
      prompt: `\`\${inWorktree('${p}')}\n${greenLine}\n${body}\``,
      schema: sch,
      agentFrag,
      modelFrag: mdl('work'),
      label: key,
      phase: p,
    }));
    return { title: p, src };
  });
};

const PHASES = [
  // DoD baseline (honesty check): measure each checkable criterion BEFORE any work. A criterion
  // already met at baseline cannot discriminate this run's work — the run report flags it.
  { title: 'DoDBaseline', enabledWhen: withDod && dodCheckable.length > 0, build: () => emitPhase('DoDBaseline',
    agentCall({
      key: 'dodBaseline',
      prompt: tpl('dod-baseline.txt'),
      schema: SCHEMA({ baselines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'status'], properties: { id: { type: 'string' }, status: { type: 'string', enum: ['met', 'unmet', 'error'] } } } } }, ['baselines']),
      modelFrag: mdl('mechanical'), label: 'dod-baseline', phase: 'DoDBaseline',
    })) },

  { title: 'Brief', enabledWhen: withTicket, build: () => emitPhase('Brief',
    agentCall({
      key: 'brief',
      prompt: tpl('brief.txt'),
      schema: SCHEMA({ title: { type: 'string' }, goal: { type: 'string' }, acceptanceCriteria: { type: 'array', items: { type: 'string' } } }, ['goal']),
      modelFrag: mdl('think'), label: 'brief', phase: 'Brief',
    }),
    { extraGuard: { cond: '!TICKET', msg: 'No ticket — goal came from the invocation text' } }) },

  { title: 'RED', enabledWhen: withCycle, build: () => emitPhase('RED',
    agentCall({
      key: 'red',
      prompt: tpl('red.txt'),
      schema: SCHEMA({ red: { type: 'boolean' }, tests: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, ['red']),
      agentFrag: at(agentRed), modelFrag: mdl('think'), label: 'red', phase: 'RED',
      check: `if (!results.red || !results.red.red) throw new Error('RED failed: tests did not establish a failing baseline — ' + (results.red && results.red.summary || ''))`,
    })) },

  // Work phases (one per --phases title) splice in here.
  { title: '@work', enabledWhen: true, build: workPhasesBuild },

  { title: 'Verify', enabledWhen: withCycle, build: () => emitPhase('Verify',
    agentCall({
      key: 'verify',
      prompt: tpl('verify.txt'),
      schema: SCHEMA({ green: { type: 'boolean' }, failing: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, ['green']),
      modelFrag: mdl('mechanical'), label: 'verify', phase: 'Verify',
      check: `if (!results.verify || !results.verify.green) throw new Error('Verify failed: not green — ' + (results.verify && (results.verify.failing || []).join(', ')))`,
    })) },

  { title: 'PathGap', enabledWhen: withCycle, build: () => emitPhase('PathGap',
    '  // Close test gaps for code paths the ACs never specified (decide-or-justify, hard-fail).\n' + gateLoop({
      flag: 'closed', resultKey: 'pathGap', label: 'pathgap', phase: 'PathGap', modelFrag: mdl('think'), dod: false,
      prompt: tpl('pathgap.txt'),
      schema: SCHEMA({ closed: { type: 'boolean' }, uncovered: { type: 'number' }, tested: { type: 'number' }, justified: { type: 'number' }, summary: { type: 'string' } }, ['closed']),
      throwMsg: `'PathGap failed: uncovered changed-code branches remain after 3 rounds — ' + (last && last.summary || '')`,
    })) },

  // CodeGate = IMPROVE+SIMPLIFY; emitted when --enforce-code OR --cycle (cycle always reviews).
  // reviewPanel swaps the single review+fix agent for the multi-dimension panel.
  { title: 'CodeGate', enabledWhen: enforceCode || withCycle, build: () => emitPhase('CodeGate',
    reviewPanel ? panelBody() : gateLoop({
      flag: 'gatePassed', resultKey: 'codeGate', label: 'codegate', phase: 'CodeGate', agentFrag: at(agentCode), modelFrag: mdl('think'), buildEvidence: true,
      prompt: tpl('codegate.txt', { GATE_CONTRACT, BUILD_EVIDENCE }),
      schema: SCHEMA({ gatePassed: { type: 'boolean' }, critical: { type: 'number' }, high: { type: 'number' }, summary: { type: 'string' }, buildCmd: { type: 'string' }, buildExit: { type: 'number' } }, ['gatePassed', 'critical', 'high', 'buildCmd', 'buildExit']),
      throwMsg: `'CodeGate failed: unresolved Critical/High after 3 rounds — ' + (last && last.summary || '')`,
    })) },

  // ReVerify follows CodeGate in --cycle mode.
  { title: 'ReVerify', enabledWhen: withCycle, build: () => emitPhase('ReVerify',
    agentCall({
      key: 'reVerify',
      prompt: tpl('reverify.txt'),
      schema: SCHEMA({ green: { type: 'boolean' }, regressions: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, ['green']),
      modelFrag: mdl('mechanical'), label: 'reverify', phase: 'ReVerify',
      check: `if (!results.reVerify || !results.reVerify.green) throw new Error('ReVerify failed: regression after improve/simplify — ' + (results.reVerify && (results.reVerify.regressions || []).join(', ')))`,
    })) },

  // TestGate (triage-based): NON-cycle test enforcement; replaced by RED/Verify/PathGap/ReVerify under --cycle.
  { title: 'TestGate', enabledWhen: enforceTests && !withCycle, build: () => emitPhase('TestGate',
    `  // Assess what testing the change ACTUALLY needs — do not enforce blindly.
  const assess = await agent(
    ${tpl('testgate-assess.txt')},
    { label: 'testgate:assess', phase: 'TestGate',${mdl('think') ? ' ' + mdl('think') : ''}
      schema: ${SCHEMA({ level: { type: 'string', enum: ['tryve-e2e', 'unit', 'none'] }, reason: { type: 'string' } }, ['level'])} },
  )
  results.testAssessment = assess
  if (assess && assess.level === 'none') {
    log('TestGate: no new tests warranted (' + (assess.reason || '') + ') — passing')
  } else {
    let passed = false, last = null
    for (let round = 1; round <= 3 && !passed; round++) {
      ${DOD_DECL}
      ${CARRY_DECL}
      last = await agent(
        ${tpl('testgate-fix.txt')} + dod + carry,
        { label: \`testgate:r\${round}\`, phase: 'TestGate', ${at(agentTests)}${mdl('think') ? ' ' + mdl('think') : ''}
          schema: ${SCHEMA({ gatePassed: { type: 'boolean' }, summary: { type: 'string' } }, ['gatePassed'])} },
      )
      passed = last && last.gatePassed
    }
    if (!passed) throw new Error('TestGate failed: ' + (assess && assess.level) + ' tests not green after 3 rounds — ' + (last && last.summary || ''))
    results.testGate = last
  }`) },

  // Review = CodeGate + TestGate collapsed (--merge-gates / --profile lite); not under --cycle.
  { title: 'Review', enabledWhen: mergeGates && !withCycle, build: () => emitPhase('Review',
    gateLoop({
      flag: 'gatePassed', resultKey: 'review', label: 'review', phase: 'Review', agentFrag: at(agentCode), modelFrag: mdl('think'), buildEvidence: true,
      prompt: tpl('review.txt', { GATE_CONTRACT, BUILD_EVIDENCE }),
      schema: SCHEMA({ gatePassed: { type: 'boolean' }, critical: { type: 'number' }, high: { type: 'number' }, summary: { type: 'string' }, buildCmd: { type: 'string' }, buildExit: { type: 'number' } }, ['gatePassed', 'critical', 'high', 'buildCmd', 'buildExit']),
      throwMsg: `'Review failed: unresolved Critical/High or tests not green after 3 rounds — ' + (last && last.summary || '')`,
    })) },

  // FrontendGate: UI/mobile verification (--frontend web|mobile|both). Positioned AFTER the
  // code-quality gate (CodeGate/ReVerify under --cycle; merged Review under lite) so evidence
  // reflects final code, and BEFORE DoDGate/Writeup so DoDGate can cite the evidence manifest
  // at implementation-notes/frontend-evidence/manifest.json.
  { title: 'FrontendGate', enabledWhen: withFrontend, build: () => emitPhase('FrontendGate', frontendBody()) },

  { title: 'DocsGate', enabledWhen: enforceDocs, build: () => emitPhase('DocsGate',
    agentCall({
      key: 'docs',
      prompt: tpl('docsgate.txt'),
      schema: SCHEMA({ written: { type: 'boolean' }, docPath: { type: 'string' } }, ['written']),
      agentFrag: at(agentDocs), modelFrag: mdl('think'), label: 'docs', phase: 'DocsGate',
      check: `if (!results.docs || !results.docs.written) throw new Error('DocsGate failed: no implementation summary written')`,
    })) },

  // DoDGate: verify the frozen definition of done (checkable = run the command; judged =
  // evidence-cited verdict). UNMET → fix worker → re-verify, ≤3 rounds, then hard-fail.
  // Placed BEFORE Writeup/PR so a PR only ever opens with a fully-met DoD.
  { title: 'DoDGate', enabledWhen: withDod, build: () => emitPhase('DoDGate',
    `  let dodPassed = false, dodLast = null
  for (let round = 1; round <= 3 && !dodPassed; round++) {
    dodLast = await agent(
      ${tpl('dodgate-verify.txt')},
      { label: \`dodgate:verify-r\${round}\`, phase: 'DoDGate',${mdl('think') ? ' ' + mdl('think') : ''}
        schema: ${SCHEMA({ criteria: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'verdict', 'evidence'], properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['MET', 'UNMET', 'PARTIAL'] }, evidence: { type: 'string' } } } } }, ['criteria'])} },
    )
    const unmet = ((dodLast && dodLast.criteria) || []).filter((c) => c.verdict !== 'MET')
    dodPassed = !!(dodLast && (dodLast.criteria || []).length && unmet.length === 0)
    if (!dodPassed && round < 3) {
      await agent(
        ${tpl('dodgate-fix.txt')},
        { label: \`dodgate:fix-r\${round}\`, phase: 'DoDGate',${mdl('work') ? ' ' + mdl('work') : ''}
          schema: ${SCHEMA({ summary: { type: 'string' }, fixed: { type: 'array', items: { type: 'string' } } }, ['summary'])} },
      )
    }
  }
  results.dodGate = dodLast
  if (!dodPassed) throw new Error('DoDGate failed: DoD not fully met after 3 rounds — unmet: ' + ((dodLast && dodLast.criteria) || []).filter((c) => c.verdict !== 'MET').map((c) => c.id).join(', '))`) },

  // Writeup: promote the per-worker implementation-notes + emit a reviewer write-up and a design
  // diagram, all committed under docs/changes/<name>/ so they ride the PR. Hard-fails (placed
  // BEFORE PR) so "every PR has reviewer artifacts" is actually enforced; --no-writeup opts out.
  { title: 'Writeup', enabledWhen: withWriteup, build: () => emitPhase('Writeup',
    agentCall({
      key: 'writeup',
      prompt: tpl('writeup.txt'),
      schema: SCHEMA({ written: { type: 'boolean' }, writeupPath: { type: 'string' }, designPath: { type: 'string' }, notesPreserved: { type: 'number' } }, ['written']),
      modelFrag: mdl('think'), label: 'writeup', phase: 'Writeup',
      check: `if (!results.writeup || !results.writeup.written) throw new Error('Writeup failed: reviewer artifacts not written under docs/changes/')`,
    })) },

  { title: 'PR', enabledWhen: withPR, build: () => emitPhase('PR',
    agentCall({
      key: 'pr',
      prompt: tpl('pr.txt', {
        WRITEUP_NOTE: withWriteup ? promptTpl('pr-writeup-note.txt', { NAME: name }) : '',
        DOD_SECTION: withDod ? promptTpl('pr-dod-section.txt') + '\n' : '',
      }),
      schema: SCHEMA({ prUrl: { type: 'string' } }, ['prUrl']),
      modelFrag: mdl('mechanical'), label: 'pr', phase: 'PR',
    })) },

  { title: 'TicketUpdate', enabledWhen: withTicket, build: () => emitPhase('TicketUpdate',
    agentCall({
      key: 'ticketUpdate',
      prompt: tpl('ticket-update.txt'),
      schema: SCHEMA({ updated: { type: 'boolean' }, transition: { type: 'string' } }, ['updated']),
      modelFrag: mdl('mechanical'), label: 'ticket-update', phase: 'TicketUpdate',
    }),
    { extraGuard: { cond: '!TICKET', msg: 'No ticket — nothing to update' } }) },
];

// Derive BOTH the order (titles) and the blocks from the ONE table. Work phases expand inline.
const activeDescriptors = PHASES.filter((d) => d.enabledWhen);
const expanded = []; // [{ title, src }]
for (const d of activeDescriptors) {
  const built = d.build();
  if (Array.isArray(built)) expanded.push(...built);
  else expanded.push({ title: d.title, src: built });
}
const phaseOrder = ['Setup', ...expanded.map((e) => e.title)];
const metaPhases = phaseOrder.map((t) => `    { title: '${t}' },`).join('\n');
const coreBlocks = expanded.map((e) => e.src).join('\n');

const src = `// AUTO-GENERATED by scaffold-workflow.cjs — do NOT hand-edit.
// Work-phase prompts come from --prompt/--prompts-file (data-in). To change a prompt OR the
// structure, re-run the generator with --force. A leftover \\\`TODO:\\\` means a prompt wasn't
// supplied — fill it by regenerating, not by editing this file.
//
// Conductor rules: pure JS only — no fs/git, no Date.now()/Math.random().
// All side-effects happen inside agent() subagents.
//
// Resume semantics: phases are AT-LEAST-ONCE on resume. We checkpoint AFTER the
// side-effect, so a crash between side-effect and checkpoint re-runs that phase.
// Every phase MUST therefore be idempotent. phasesDone is trusted only after the
// entry guard below validates it is a contiguous prefix of the phase order.

export const meta = {
  name: '${name}',
  description: '${desc.replace(/'/g, "\\'")}',
  phases: [
${metaPhases}
  ],
}

// Some Workflow harnesses deliver \`args\` as a JSON STRING rather than an object; normalize
// once here (BEFORE any args read) so every \`(args && args.X)\` guard below works either way.
// Uses only typeof + JSON.parse — both allowed at the restricted conductor layer.
if (typeof args === 'string') args = JSON.parse(args)

const NAME     = '${name}'
const STATE    = \`.workflows/state/\${NAME}.json\`
const BRANCH   = (args && args.branch) ? args.branch : \`wf/\${NAME}\`
const BASE     = (args && args.base) ? args.base : '${base === true ? '' : base}'
const WORKTREE = \`.worktrees/\${NAME}\`
const TICKET   = (args && args.ticket) ? args.ticket : ${withTicket ? 'null' : 'null'}${withDod ? `\nconst DOD_CRITERIA = ${JSON.stringify(dodCriteria)}` : ''}

const prior = (args && args.results) ? args.results : {}
const done  = new Set((args && args.phasesDone) ? args.phasesDone : [])
const results = { ...prior }

// --- Resume reachability guard: phasesDone MUST be a contiguous prefix ---
// Canonical order is baked in as a literal — the Workflow runtime consumes \`meta\` as
// metadata, so it is NOT a runtime binding in this body. A durable state that marks a
// phase done while an earlier phase is not is unreachable (corrupt/forged) — reject it
// loudly instead of silently skipping required setup work.
;(() => {
  const order = ${JSON.stringify(phaseOrder)}
  for (const title of done) {
    if (!order.includes(title)) {
      throw new Error(\`Unreachable resume: phasesDone has unknown phase '\${title}' (not in order: \${order.join(' → ')})\`)
    }
  }
  // Walk the order; once we hit the first NOT-done phase, no later phase may be done.
  let seenGap = false
  for (const title of order) {
    if (done.has(title)) {
      if (seenGap) {
        throw new Error(\`Unreachable resume: phase '\${title}' is done but an earlier required phase is not — phasesDone must be a contiguous prefix of [\${order.join(' → ')}], got [\${[...done].join(', ')}]\`)
      }
    } else {
      seenGap = true
    }
  }
})()

${promptTpl('in-worktree.txt')}

// startedAt-preserving merge: cat clobbers the file, so read prev startedAt first.
async function checkpoint(phaseTitle) {
  const payload = JSON.stringify(
    { workflow: NAME, status: 'running', branch: BRANCH, worktree: WORKTREE, ticket: TICKET,${withDod ? ' dod: { criteria: DOD_CRITERIA },' : ''} phasesDone: [...done], results },
    null, 2,
  )
  await agent(
    ${tpl('checkpoint.txt')},
    { label: \`checkpoint:\${phaseTitle}\`, phase: phaseTitle,${mechFrag ? ' ' + mechFrag : ''}
      schema: { type: 'object', additionalProperties: false, required: ['written'], properties: { written: { type: 'boolean' }, path: { type: 'string' } } } },
  )
}

// --- Setup: create/reuse worktree + symlink node_modules (worktrees don't carry it) ---
phase('Setup')
if (done.has('Setup')) {
  log('Setup already complete (resumed)')
} else {
  results.setup = await agent(
    ${tpl('setup-worktree.txt')},
    { label: 'setup:worktree', phase: 'Setup',${mechFrag ? ' ' + mechFrag : ''}
      schema: { type: 'object', additionalProperties: false, required: ['ready'], properties: { ready: { type: 'boolean' }, worktree: { type: 'string' }, branch: { type: 'string' } } } },
  )
  done.add('Setup')
  await checkpoint('Setup')
}
${coreBlocks}

return { workflow: NAME, status: 'complete', branch: BRANCH, worktree: WORKTREE, ticket: TICKET, phasesDone: [...done], results }
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, src);
console.log(`Generated ${out}`);
console.log(`Phases: ${phaseOrder.join(' → ')}`);
console.log(modelMode === 'auto'
  ? `Model mode: auto (think=${modelThink}, work=${modelWork}, mechanical=haiku)`
  : `Model mode: default (workers inherit the session model)`);
if (pendingTodos > 0) {
  console.log(`${pendingTodos} work phase(s) still hold a TODO prompt — regenerate with --prompt/--prompts-file (+ --force) to fill them from data. Do NOT hand-edit. Then launch.`);
} else {
  console.log(`Launch-ready: all work-phase prompts filled from data. Confirm the phase order above, then launch via the Workflow tool — no need to read the script.`);
}

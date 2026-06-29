#!/usr/bin/env node
/*
 * Deterministically generate a conductor conductor from params.
 * Replaces "copy a template and hope the LLM fills it correctly" — all the mechanical
 * boilerplate (NAME/STATE/BRANCH consts, checkpoint() with startedAt-preserving merge,
 * Setup worktree+node_modules, resume guards, optional Brief/PR/TicketUpdate, finalize)
 * is emitted here. The work-phase prompts are passed in as DATA (--prompt/--prompts-file),
 * so the caller never reads back or hand-edits the generated script.
 *
 * Usage:
 *   node scaffold-workflow.cjs --name <slug> [options]
 * Options:
 *   --name <slug>        required; drives state/branch/worktree paths
 *   --phases <a,b,c>     work phase titles (default: "Work")
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

const name = arg('name');
if (!name || name === true) { console.error('ERROR: --name <slug> is required'); process.exit(1); }
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) { console.error('ERROR: --name must be a kebab slug (a-z0-9-)'); process.exit(1); }

const phases = String(arg('phases', 'Work')).split(',').map((s) => s.trim()).filter(Boolean);
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
const out = arg('out', path.join('.workflows', name + '.js'));
const force = arg('force', false) === true;

// Agent overrides — default to the bundled lirbox agents, override per gate, or `none` for a
// generic built-in subagent (no agent dependency).
const agentRed = arg('agent-red', 'lirbox:lirbox-test-writer');
const agentCode = arg('agent-code', 'lirbox:lirbox-code-reviewer');
const agentTests = arg('agent-tests', 'lirbox:lirbox-tryve-enhancer');
const agentDocs = arg('agent-docs', 'lirbox:lirbox-docs-writer');
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

// A bounded 3-round gate: run the agent up to 3× until `flag` is truthy, else throw.
// `prompt`/`schema` are template-literal source fragments; `agentFrag` is the optional
// `agentType: '...',` (or '' for a generic subagent). Output is indented for the else-block.
function gateLoop({ flag, prompt, schema, agentFrag, modelFrag, label, phase: ph, throwMsg, resultKey }) {
  const lead = [agentFrag, modelFrag].filter(Boolean).join(' ');
  return `  let passed = false, last = null
  for (let round = 1; round <= 3 && !passed; round++) {
    last = await agent(
      ${prompt},
      { label: \`${label}:r\${round}\`, phase: '${ph}',${lead ? ' ' + lead : ''}
        schema: ${schema} },
    )
    passed = last && last.${flag}
  }
  if (!passed) throw new Error(${throwMsg})
  results.${resultKey} = last`;
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
const workPhasesBuild = () => phases.map((p) => {
  const key = camel(p);
  const provided = (spec.phases && spec.phases[p]) || (promptMap[p] != null ? String(promptMap[p]) : '');
  if (!provided) pendingTodos++;
  const body = provided
    ? escTpl(provided)
    : `TODO: describe the ${p} work here. (Pass --prompt/--prompts-file to fill this from data.)`;
  const greenLine = withCycle ? '\nGREEN: implement until the RED tests pass; never weaken or delete tests to go green.\n' : '';
  const sch = (spec.phases && spec.phases[p] && spec.phases[p + '.schema']) || SCHEMA({ summary: { type: 'string' } }, ['summary']);
  const agentFrag = (spec.phases && spec.phases[p + '.agent']) ? at(spec.phases[p + '.agent']) : '';
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

const PHASES = [
  { title: 'Brief', enabledWhen: withTicket, build: () => emitPhase('Brief',
    agentCall({
      key: 'brief',
      prompt: `\`Fetch tracker ticket \${TICKET} and write a concise goal + acceptance criteria.
Use ToolSearch to load the tracker tools, then fetch verbatim (do NOT rephrase AC/DoD):
- Jira:   mcp__atlassian__getJiraIssue (issueIdOrKey: "\${TICKET}")
- Linear: the Linear MCP get-issue tool, ONLY if a Linear server is connected.\``,
      schema: SCHEMA({ title: { type: 'string' }, goal: { type: 'string' }, acceptanceCriteria: { type: 'array', items: { type: 'string' } } }, ['goal']),
      modelFrag: mdl('think'), label: 'brief', phase: 'Brief',
    }),
    { extraGuard: { cond: '!TICKET', msg: 'No ticket — goal came from the invocation text' } }) },

  { title: 'RED', enabledWhen: withCycle, build: () => emitPhase('RED',
    agentCall({
      key: 'red',
      prompt: `\`\${inWorktree('red')}

RED (test-first): from the goal\${TICKET ? ' / ticket ' + TICKET : ''} and its acceptance criteria, write the tests BEFORE any implementation. Decide per behavior whether it needs a tryve E2E (tests/e2e/*.yaml) or a Jest unit test, and write them. Run them and CONFIRM THEY FAIL for the right reason — a test that already passes is not exercising the new behavior; fix it until it fails. Commit the failing tests.\``,
      schema: SCHEMA({ red: { type: 'boolean' }, tests: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, ['red']),
      agentFrag: at(agentRed), modelFrag: mdl('think'), label: 'red', phase: 'RED',
      check: `if (!results.red || !results.red.red) throw new Error('RED failed: tests did not establish a failing baseline — ' + (results.red && results.red.summary || ''))`,
    })) },

  // Work phases (one per --phases title) splice in here.
  { title: '@work', enabledWhen: true, build: workPhasesBuild },

  { title: 'Verify', enabledWhen: withCycle, build: () => emitPhase('Verify',
    agentCall({
      key: 'verify',
      prompt: `\`\${inWorktree('verify')}

VERIFY (GREEN): run the full relevant test suite for the changes on \${BRANCH} vs \${BASE || 'the base branch'} (Jest unit + any tryve E2E from RED). EVERYTHING must pass. If any test fails, the implementation is incomplete — STOP and report which failed; do NOT weaken tests to pass.\``,
      schema: SCHEMA({ green: { type: 'boolean' }, failing: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, ['green']),
      modelFrag: mdl('mechanical'), label: 'verify', phase: 'Verify',
      check: `if (!results.verify || !results.verify.green) throw new Error('Verify failed: not green — ' + (results.verify && (results.verify.failing || []).join(', ')))`,
    })) },

  { title: 'PathGap', enabledWhen: withCycle, build: () => emitPhase('PathGap',
    '  // Close test gaps for code paths the ACs never specified (decide-or-justify, hard-fail).\n' + gateLoop({
      flag: 'closed', resultKey: 'pathGap', label: 'pathgap', phase: 'PathGap', modelFrag: mdl('think'),
      prompt: `\`\${inWorktree('pathgap')}

PATH-GAP: the ACs do NOT cover every code path. Steps:
1. Run Jest with BRANCH coverage; intersect with the CHANGED lines (git diff vs \${BASE || 'the base branch'}) to find uncovered branches introduced by this change.
2. For EACH uncovered changed branch, do ONE: (a) add a unit/integration test that meaningfully exercises AND asserts it, or (b) if it is genuinely unreachable/defensive, record an explicit justification in implementation-notes/pathgap.html.
3. Re-run coverage. There must be NO silent gaps — every uncovered changed branch is either tested or justified.
Do NOT delete/alter source branches just to raise coverage. Commit new tests + notes.\``,
      schema: SCHEMA({ closed: { type: 'boolean' }, uncovered: { type: 'number' }, tested: { type: 'number' }, justified: { type: 'number' }, summary: { type: 'string' } }, ['closed']),
      throwMsg: `'PathGap failed: uncovered changed-code branches remain after 3 rounds — ' + (last && last.summary || '')`,
    })) },

  // CodeGate = IMPROVE+SIMPLIFY; emitted when --enforce-code OR --cycle (cycle always reviews).
  { title: 'CodeGate', enabledWhen: enforceCode || withCycle, build: () => emitPhase('CodeGate',
    gateLoop({
      flag: 'gatePassed', resultKey: 'codeGate', label: 'codegate', phase: 'CodeGate', agentFrag: at(agentCode), modelFrag: mdl('think'),
      prompt: `\`\${inWorktree('codegate')}

Review AND fix the changes on branch \${BRANCH} relative to \${BASE || 'the base branch'} (run git diff in \${WORKTREE}). Run the project build/lint — it MUST pass. Resolve EVERY Critical and High finding (bugs, security, rule violations, quality). Re-run the build after fixes and commit them.\``,
      schema: SCHEMA({ gatePassed: { type: 'boolean' }, critical: { type: 'number' }, high: { type: 'number' }, summary: { type: 'string' } }, ['gatePassed']),
      throwMsg: `'CodeGate failed: unresolved Critical/High after 3 rounds — ' + (last && last.summary || '')`,
    })) },

  // ReVerify follows CodeGate in --cycle mode.
  { title: 'ReVerify', enabledWhen: withCycle, build: () => emitPhase('ReVerify',
    agentCall({
      key: 'reVerify',
      prompt: `\`\${inWorktree('reverify')}

RE-VERIFY: after IMPROVE/SIMPLIFY (CodeGate), re-run the FULL test suite + branch coverage for the changes on \${BRANCH} vs \${BASE || 'the base branch'}. Everything green before must STILL be green and coverage must not have regressed. If a refactor broke anything, STOP and report; do NOT weaken tests.\``,
      schema: SCHEMA({ green: { type: 'boolean' }, regressions: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, ['green']),
      modelFrag: mdl('mechanical'), label: 'reverify', phase: 'ReVerify',
      check: `if (!results.reVerify || !results.reVerify.green) throw new Error('ReVerify failed: regression after improve/simplify — ' + (results.reVerify && (results.reVerify.regressions || []).join(', ')))`,
    })) },

  // TestGate (triage-based): NON-cycle test enforcement; replaced by RED/Verify/PathGap/ReVerify under --cycle.
  { title: 'TestGate', enabledWhen: enforceTests && !withCycle, build: () => emitPhase('TestGate',
    `  // Assess what testing the change ACTUALLY needs — do not enforce blindly.
  const assess = await agent(
    \`\${inWorktree('testgate')}

Assess the changes on branch \${BRANCH} relative to \${BASE || 'the base branch'} (git diff in \${WORKTREE}) and decide what testing the change actually warrants:
- "tryve-e2e": new/changed HTTP endpoint, behavior, or integration path → needs a tryve E2E test (tests/e2e/*.yaml).
- "unit": pure logic / service / util change → Jest unit tests suffice.
- "none": docs-only, config, comments, or non-behavioral change → no new tests required.
Return the level and a one-line justification.\`,
    { label: 'testgate:assess', phase: 'TestGate',${mdl('think') ? ' ' + mdl('think') : ''}
      schema: ${SCHEMA({ level: { type: 'string', enum: ['tryve-e2e', 'unit', 'none'] }, reason: { type: 'string' } }, ['level'])} },
  )
  results.testAssessment = assess
  if (assess && assess.level === 'none') {
    log('TestGate: no new tests warranted (' + (assess.reason || '') + ') — passing')
  } else {
    let passed = false, last = null
    for (let round = 1; round <= 3 && !passed; round++) {
      last = await agent(
        \`\${inWorktree('testgate')}

The change needs \${assess.level} coverage (\${assess.reason || ''}). Ensure the right tests for the changes on \${BRANCH} vs \${BASE || 'the base branch'} EXIST and PASS:
- unit → add/fix Jest tests; run with coverage; >90% on changed files.
- tryve-e2e → add/fix tryve E2E YAML in tests/e2e/; run \\\`yarn e2e:run\\\` and confirm green (some tryve suites need external integration envs — if unavailable, say so, do NOT fake a pass).
Do NOT change source to game coverage. Commit new tests.\`,
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
      flag: 'gatePassed', resultKey: 'review', label: 'review', phase: 'Review', agentFrag: at(agentCode), modelFrag: mdl('think'),
      prompt: `\`\${inWorktree('review')}

Review AND fix the changes on branch \${BRANCH} relative to \${BASE || 'the base branch'} (run git diff in \${WORKTREE}) in ONE pass:
1. Run the project build/lint — it MUST pass. Resolve EVERY Critical and High finding (bugs, security, rule violations, quality).
2. Decide what testing the change warrants (none for docs/config/non-behavioral; unit for pure logic; e2e for new/changed behavior or endpoints) and ensure those tests EXIST and PASS — do NOT change source to game coverage, do NOT fake a pass if an integration env is unavailable (say so).
3. Re-run build + tests after fixes and commit them.
Return whether the gate passed.\``,
      schema: SCHEMA({ gatePassed: { type: 'boolean' }, critical: { type: 'number' }, high: { type: 'number' }, summary: { type: 'string' } }, ['gatePassed']),
      throwMsg: `'Review failed: unresolved Critical/High or tests not green after 3 rounds — ' + (last && last.summary || '')`,
    })) },

  { title: 'DocsGate', enabledWhen: enforceDocs, build: () => emitPhase('DocsGate',
    agentCall({
      key: 'docs',
      prompt: `\`\${inWorktree('docsgate')}

Write an implementation summary for the changes on \${BRANCH} vs \${BASE || 'the base branch'} into docs/changes/\${NAME}/summary.md with proper frontmatter (mkdir -p the dir). Read the diff, the goal\${TICKET ? ' and ticket ' + TICKET : ''}, and ALL fragments in the implementation-notes/ directory — fold their design decisions / deviations / tradeoffs / open questions into the summary. Commit it.\``,
      schema: SCHEMA({ written: { type: 'boolean' }, docPath: { type: 'string' } }, ['written']),
      agentFrag: at(agentDocs), modelFrag: mdl('think'), label: 'docs', phase: 'DocsGate',
      check: `if (!results.docs || !results.docs.written) throw new Error('DocsGate failed: no implementation summary written')`,
    })) },

  // Writeup: promote the per-worker implementation-notes + emit a reviewer write-up and a design
  // diagram, all committed under docs/changes/<name>/ so they ride the PR. Hard-fails (placed
  // BEFORE PR) so "every PR has reviewer artifacts" is actually enforced; --no-writeup opts out.
  { title: 'Writeup', enabledWhen: withWriteup, build: () => emitPhase('Writeup',
    agentCall({
      key: 'writeup',
      prompt: `\`\${inWorktree('writeup', { notes: false })}

Produce reviewer-facing delivery artifacts for the changes on \${BRANCH} vs \${BASE || 'the base branch'}, all COMMITTED under docs/changes/\${NAME}/ in the worktree so they ride the PR:
1. PRESERVE design notes — mkdir -p docs/changes/\${NAME}/notes, then copy every implementation-notes/*.html into it (if any exist). These are the per-worker decision notes; keep them, do NOT discard.
2. WRITE-UP — invoke the lirbox:pr-writeup skill (via the Skill tool, by name) to produce a self-contained reviewer write-up of this branch's diff; save it to docs/changes/\${NAME}/writeup.html. If the Skill tool is unavailable, read plugins/lirbox/skills/pr-writeup/SKILL.md + assets/template.html and follow them.
3. DESIGN DIAGRAM — invoke the lirbox:flowchart skill (via the Skill tool, by name) to visualize the design of this change; choose the Mermaid diagram type (flowchart OR sequenceDiagram) that best fits; save to docs/changes/\${NAME}/design.html. The flowchart skill validates its own output — ensure that validation passes before continuing. If the Skill tool is unavailable, read plugins/lirbox/skills/flowchart/SKILL.md + assets/template.html, follow them, and run that skill's assets/validate.mjs on the result.
4. COMMIT all of docs/changes/\${NAME}/ on \${BRANCH}.
Return what was written.\``,
      schema: SCHEMA({ written: { type: 'boolean' }, writeupPath: { type: 'string' }, designPath: { type: 'string' }, notesPreserved: { type: 'number' } }, ['written']),
      modelFrag: mdl('think'), label: 'writeup', phase: 'Writeup',
      check: `if (!results.writeup || !results.writeup.written) throw new Error('Writeup failed: reviewer artifacts not written under docs/changes/')`,
    })) },

  { title: 'PR', enabledWhen: withPR, build: () => emitPhase('PR',
    agentCall({
      key: 'pr',
      prompt: `\`\${inWorktree('pr', { notes: false })}

Push the branch and open a PR with the GitHub CLI:
git push -u origin \${BRANCH}
gh pr create --base \${BASE || 'main'} --head \${BRANCH} --title "TODO title" --body "TODO summary${withWriteup ? '. Reviewer artifacts are committed under docs/changes/' + name + '/ — link writeup.html, design.html, and notes/ in the PR body' : ''}\${TICKET ? '; refs ' + TICKET : ''}"
If a PR for this branch already exists, return its URL instead of erroring.\``,
      schema: SCHEMA({ prUrl: { type: 'string' } }, ['prUrl']),
      modelFrag: mdl('mechanical'), label: 'pr', phase: 'PR',
    })) },

  { title: 'TicketUpdate', enabledWhen: withTicket, build: () => emitPhase('TicketUpdate',
    agentCall({
      key: 'ticketUpdate',
      prompt: `\`Update tracker ticket \${TICKET}. Use ToolSearch to load the tracker tools.
Jira: getTransitionsForJiraIssue → transitionJiraIssue to the review state (match name case-insensitively; skip if none) → addCommentToJiraIssue with the PR link \${results.pr && results.pr.prUrl}.
Linear: use the Linear MCP update/comment tools instead, ONLY if connected.\``,
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
const TICKET   = (args && args.ticket) ? args.ticket : ${withTicket ? 'null' : 'null'}

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

// Per-worker instruction. \`slot\` makes the notes file UNIQUE so parallel / multiple agents
// never clobber each other. For a parallel fan-out, pass a slot unique per item (e.g. \`phase-\${i}\`).
// Pass { notes: false } for mechanical steps (PR push, etc.) that make no design decisions —
// they should NOT create a notes file at all. Where notes ARE offered they are judgment-gated:
// write one ONLY if there is something a reviewer genuinely needs.
function inWorktree(slot, opts) {
  const base = \`Work ONLY inside the git worktree at \${WORKTREE} (run \\\`cd \${WORKTREE}\\\` first; it is on \` +
    \`branch \${BRANCH}). Do NOT edit any file outside \${WORKTREE}. Commit your changes there.\`
  if (opts && opts.notes === false) return base
  return base + \`\\n\\nIf — and ONLY if — this step involved a non-trivial design decision, an \` +
    \`intentional deviation from the spec, a tradeoff between real alternatives, or an open question a \` +
    \`reviewer must confirm, append it to a notes file UNIQUE to you at implementation-notes/\${slot}.html \` +
    \`in the worktree (mkdir -p the dir; create if missing; APPEND — never clobber). For mechanical or \` +
    \`no-decision work, SKIP the file — do not create empty or boilerplate notes.\`
}

// startedAt-preserving merge: cat clobbers the file, so read prev startedAt first.
async function checkpoint(phaseTitle) {
  const payload = JSON.stringify(
    { workflow: NAME, status: 'running', branch: BRANCH, worktree: WORKTREE, ticket: TICKET, phasesDone: [...done], results },
    null, 2,
  )
  await agent(
    \`Persist durable workflow state to the MAIN repo (do NOT cd into the worktree). Run EXACTLY:

mkdir -p .workflows/state
cat > .workflows/state/.\${NAME}.payload.json <<'DURABLE_JSON'
\${payload}
DURABLE_JSON
node -e "const fs=require('fs');const f='\${STATE}';const p='.workflows/state/.\${NAME}.payload.json';let prev={};try{prev=JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){};const s=JSON.parse(fs.readFileSync(p,'utf8'));const n=new Date().toISOString();s.startedAt=prev.startedAt||n;s.updatedAt=n;fs.writeFileSync(f,JSON.stringify(s,null,2));fs.unlinkSync(p)"
node -e "JSON.parse(require('fs').readFileSync('\${STATE}','utf8'))" && echo OK

Return whether the file was written and parses.\`,
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
    \`Create an isolated git worktree. Run idempotently:

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: not a git repo"; exit 1; }
ROOT="\$(git rev-parse --show-toplevel)"
if git worktree list --porcelain | grep -q "/\${WORKTREE}\$"; then
  echo "worktree exists — reusing"
elif git show-ref --verify --quiet "refs/heads/\${BRANCH}"; then
  git worktree add "\${WORKTREE}" "\${BRANCH}"
else
  # Branch from the FRESH remote tip, not a possibly-stale local ref.
  git fetch origin --quiet 2>/dev/null || echo "WARN: git fetch origin failed — using local refs (may be stale)"
  BASEREF="\${BASE}"
  # Auto-detect the remote's default branch when no --base was given.
  [ -n "\$BASEREF" ] || BASEREF="\$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
  if [ -n "\$BASEREF" ] && git show-ref --verify --quiet "refs/remotes/origin/\$BASEREF"; then
    START="origin/\$BASEREF"
  elif [ -n "\$BASEREF" ]; then
    echo "WARN: origin/\$BASEREF not found — branching from local \$BASEREF (may be stale)"; START="\$BASEREF"
  else
    echo "WARN: could not detect remote default branch — branching from current HEAD (may be stale)"; START="HEAD"
  fi
  echo "Branching \${BRANCH} from \$START"
  git worktree add "\${WORKTREE}" -b "\${BRANCH}" "\$START"
fi
[ -e "\${WORKTREE}/node_modules" ] || [ ! -d "\$ROOT/node_modules" ] || ln -s "\$ROOT/node_modules" "\${WORKTREE}/node_modules"
test -d "\${WORKTREE}" && echo OK\`,
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

#!/usr/bin/env node
/*
 * Deterministically generate a conductor conductor from params.
 * Replaces "copy a template and hope the LLM fills it correctly" — all the mechanical
 * boilerplate (NAME/STATE/BRANCH consts, checkpoint() with startedAt-preserving merge,
 * Setup worktree+node_modules, resume guards, optional Brief/PR/TicketUpdate, finalize)
 * is emitted here. The LLM then edits ONLY the `TODO:` agent prompts in the work phases.
 *
 * Usage:
 *   node scaffold-workflow.cjs --name <slug> [options]
 * Options:
 *   --name <slug>        required; drives state/branch/worktree paths
 *   --phases <a,b,c>     work phase titles (default: "Work")
 *   --desc <text>        meta.description (default derived from name)
 *   --base <ref>         worktree branch point (default: current HEAD)
 *   --ticket             include Brief (fetch ticket) + TicketUpdate phases
 *   --pr                 include a PR phase (push branch + gh pr create)
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
const profileDelivery = arg('profile', false) === 'delivery';
const withCycle = profileDelivery || arg('cycle', false) === true;
const withTicket = profileDelivery || arg('ticket', false) === true || typeof arg('ticket', false) === 'string';
const withPR = profileDelivery || arg('pr', false) === true;
const enforceCode = profileDelivery || arg('enforce-code', false) === true;
const enforceTests = profileDelivery || arg('enforce-tests', false) === true;
const enforceDocs = profileDelivery || arg('enforce-docs', false) === true;
const out = arg('out', path.join('.workflows', name + '.js'));
const force = arg('force', false) === true;

// Agent overrides — default to the bundled lirbox agents, override per gate, or `none` for a
// generic built-in subagent (no agent dependency).
const agentRed = arg('agent-red', 'lirbox-test-writer');
const agentCode = arg('agent-code', 'lirbox-code-reviewer');
const agentTests = arg('agent-tests', 'lirbox-tryve-enhancer');
const agentDocs = arg('agent-docs', 'lirbox-docs-writer');
// Emits the `agentType: '...',` fragment, or '' when set to none/empty (→ generic subagent).
const at = (a) => (a && a !== 'none' && a !== true) ? `agentType: '${a}',` : '';

if (fs.existsSync(out) && !force) { console.error(`ERROR: ${out} exists (use --force to overwrite)`); process.exit(1); }

const camel = (s) => s.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ')
  .map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1))).join('');

const SCHEMA = (props, req) =>
  `{ type: 'object', additionalProperties: false, required: ${JSON.stringify(req)}, properties: ${JSON.stringify(props)} }`;

// ---- phase order (shared by meta + summary print) ----
// --cycle: RED → GREEN(work) → Verify → PathGap → IMPROVE/SIMPLIFY(CodeGate) → ReVerify.
const coreOrder = withCycle
  ? ['RED', ...phases, 'Verify', 'PathGap', 'CodeGate', 'ReVerify']
  : [...phases, ...(enforceCode ? ['CodeGate'] : []), ...(enforceTests ? ['TestGate'] : [])];
const phaseOrder = ['Setup',
  ...(withTicket ? ['Brief'] : []),
  ...coreOrder,
  ...(enforceDocs ? ['DocsGate'] : []),
  ...(withPR ? ['PR'] : []),
  ...(withTicket ? ['TicketUpdate'] : [])];
const metaPhases = phaseOrder.map((t) => `    { title: '${t}' },`).join('\n');

// ---- work phase blocks (stubbed prompts for the LLM to fill) ----
const workBlocks = phases.map((p) => {
  const key = camel(p);
  return `
phase('${p}')
if (done.has('${p}')) {
  log('${p} already complete (resumed)')
} else {
  results.${key} = await agent(
    \`\${inWorktree('${p}')}
${withCycle ? '\nGREEN: implement until the RED tests pass; never weaken or delete tests to go green.\n' : ''}
TODO: describe the ${p} work here. (This is the ONLY part to edit by hand.)\`,
    { label: '${key}', phase: '${p}', schema: ${SCHEMA({ summary: { type: 'string' } }, ['summary'])} },
  )
  done.add('${p}')
  await checkpoint('${p}')
}`;
}).join('\n');

const briefBlock = !withTicket ? '' : `
phase('Brief')
if (!TICKET) {
  log('No ticket — goal came from the invocation text')
} else if (done.has('Brief')) {
  log('Brief already complete (resumed)')
} else {
  results.brief = await agent(
    \`Fetch tracker ticket \${TICKET} and write a concise goal + acceptance criteria.
Use ToolSearch to load the tracker tools, then fetch verbatim (do NOT rephrase AC/DoD):
- Jira:   mcp__atlassian__getJiraIssue (issueIdOrKey: "\${TICKET}")
- Linear: the Linear MCP get-issue tool, ONLY if a Linear server is connected.\`,
    { label: 'brief', phase: 'Brief', schema: ${SCHEMA({ title: { type: 'string' }, goal: { type: 'string' }, acceptanceCriteria: { type: 'array', items: { type: 'string' } } }, ['goal'])} },
  )
  done.add('Brief')
  await checkpoint('Brief')
}`;

const prBlock = !withPR ? '' : `
phase('PR')
if (done.has('PR')) {
  log('PR already complete (resumed)')
} else {
  results.pr = await agent(
    \`\${inWorktree('pr')}

Push the branch and open a PR with the GitHub CLI:
git push -u origin \${BRANCH}
gh pr create --base \${BASE || 'main'} --head \${BRANCH} --title "TODO title" --body "TODO summary\${TICKET ? '; refs ' + TICKET : ''}"
If a PR for this branch already exists, return its URL instead of erroring.\`,
    { label: 'pr', phase: 'PR', schema: ${SCHEMA({ prUrl: { type: 'string' } }, ['prUrl'])} },
  )
  done.add('PR')
  await checkpoint('PR')
}`;

const ticketUpdateBlock = !withTicket ? '' : `
phase('TicketUpdate')
if (!TICKET) {
  log('No ticket — nothing to update')
} else if (done.has('TicketUpdate')) {
  log('TicketUpdate already complete (resumed)')
} else {
  results.ticketUpdate = await agent(
    \`Update tracker ticket \${TICKET}. Use ToolSearch to load the tracker tools.
Jira: getTransitionsForJiraIssue → transitionJiraIssue to the review state (match name case-insensitively; skip if none) → addCommentToJiraIssue with the PR link \${results.pr && results.pr.prUrl}.
Linear: use the Linear MCP update/comment tools instead, ONLY if connected.\`,
    { label: 'ticket-update', phase: 'TicketUpdate', schema: ${SCHEMA({ updated: { type: 'boolean' }, transition: { type: 'string' } }, ['updated'])} },
  )
  done.add('TicketUpdate')
  await checkpoint('TicketUpdate')
}`;

// ---- enforcement gates (hard-fail; use bundled agents via agentType) ----
// CodeGate = IMPROVE+SIMPLIFY; emitted when --enforce-code OR --cycle (cycle always reviews).
const codeGateBlock = (!enforceCode && !withCycle) ? '' : `
phase('CodeGate')
if (done.has('CodeGate')) {
  log('CodeGate already complete (resumed)')
} else {
  let passed = false, last = null
  for (let round = 1; round <= 3 && !passed; round++) {
    last = await agent(
      \`\${inWorktree('codegate')}

Review AND fix the changes on branch \${BRANCH} relative to \${BASE || 'the base branch'} (run git diff in \${WORKTREE}). Run the project build/lint — it MUST pass. Resolve EVERY Critical and High finding (bugs, security, rule violations, quality). Re-run the build after fixes and commit them.\`,
      { label: \`codegate:r\${round}\`, phase: 'CodeGate', ${at(agentCode)}
        schema: ${SCHEMA({ gatePassed: { type: 'boolean' }, critical: { type: 'number' }, high: { type: 'number' }, summary: { type: 'string' } }, ['gatePassed'])} },
    )
    passed = last && last.gatePassed
  }
  if (!passed) throw new Error('CodeGate failed: unresolved Critical/High after 3 rounds — ' + (last && last.summary || ''))
  results.codeGate = last
  done.add('CodeGate')
  await checkpoint('CodeGate')
}`;

// TestGate (triage-based) is the NON-cycle test enforcement; in --cycle mode RED/Verify/PathGap/ReVerify replace it.
const testGateBlock = (!enforceTests || withCycle) ? '' : `
phase('TestGate')
if (done.has('TestGate')) {
  log('TestGate already complete (resumed)')
} else {
  // Assess what testing the change ACTUALLY needs — do not enforce blindly.
  const assess = await agent(
    \`\${inWorktree('testgate')}

Assess the changes on branch \${BRANCH} relative to \${BASE || 'the base branch'} (git diff in \${WORKTREE}) and decide what testing the change actually warrants:
- "tryve-e2e": new/changed HTTP endpoint, behavior, or integration path → needs a tryve E2E test (tests/e2e/*.yaml).
- "unit": pure logic / service / util change → Jest unit tests suffice.
- "none": docs-only, config, comments, or non-behavioral change → no new tests required.
Return the level and a one-line justification.\`,
    { label: 'testgate:assess', phase: 'TestGate',
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
        { label: \`testgate:r\${round}\`, phase: 'TestGate', ${at(agentTests)}
          schema: ${SCHEMA({ gatePassed: { type: 'boolean' }, summary: { type: 'string' } }, ['gatePassed'])} },
      )
      passed = last && last.gatePassed
    }
    if (!passed) throw new Error('TestGate failed: ' + (assess && assess.level) + ' tests not green after 3 rounds — ' + (last && last.summary || ''))
    results.testGate = last
  }
  done.add('TestGate')
  await checkpoint('TestGate')
}`;

const docsGateBlock = !enforceDocs ? '' : `
phase('DocsGate')
if (done.has('DocsGate')) {
  log('DocsGate already complete (resumed)')
} else {
  results.docs = await agent(
    \`\${inWorktree('docsgate')}

Write an implementation summary for the changes on \${BRANCH} vs \${BASE || 'the base branch'} into docs/changes/ with proper frontmatter. Read the diff, the goal\${TICKET ? ' and ticket ' + TICKET : ''}, and ALL fragments in the implementation-notes/ directory — fold their design decisions / deviations / tradeoffs / open questions into the summary. Commit it.\`,
    { label: 'docs', phase: 'DocsGate', ${at(agentDocs)}
      schema: ${SCHEMA({ written: { type: 'boolean' }, docPath: { type: 'string' } }, ['written'])} },
  )
  if (!results.docs || !results.docs.written) throw new Error('DocsGate failed: no implementation summary written')
  done.add('DocsGate')
  await checkpoint('DocsGate')
}`;

// ---- TDD cycle blocks (only when --cycle): RED → (work=GREEN) → Verify → PathGap → CodeGate → ReVerify ----
const redBlock = !withCycle ? '' : `
phase('RED')
if (done.has('RED')) {
  log('RED already complete (resumed)')
} else {
  results.red = await agent(
    \`\${inWorktree('red')}

RED (test-first): from the goal\${TICKET ? ' / ticket ' + TICKET : ''} and its acceptance criteria, write the tests BEFORE any implementation. Decide per behavior whether it needs a tryve E2E (tests/e2e/*.yaml) or a Jest unit test, and write them. Run them and CONFIRM THEY FAIL for the right reason — a test that already passes is not exercising the new behavior; fix it until it fails. Commit the failing tests.\`,
    { label: 'red', phase: 'RED', ${at(agentRed)}
      schema: ${SCHEMA({ red: { type: 'boolean' }, tests: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, ['red'])} },
  )
  if (!results.red || !results.red.red) throw new Error('RED failed: tests did not establish a failing baseline — ' + (results.red && results.red.summary || ''))
  done.add('RED')
  await checkpoint('RED')
}`;

const verifyBlock = !withCycle ? '' : `
phase('Verify')
if (done.has('Verify')) {
  log('Verify already complete (resumed)')
} else {
  results.verify = await agent(
    \`\${inWorktree('verify')}

VERIFY (GREEN): run the full relevant test suite for the changes on \${BRANCH} vs \${BASE || 'the base branch'} (Jest unit + any tryve E2E from RED). EVERYTHING must pass. If any test fails, the implementation is incomplete — STOP and report which failed; do NOT weaken tests to pass.\`,
    { label: 'verify', phase: 'Verify',
      schema: ${SCHEMA({ green: { type: 'boolean' }, failing: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, ['green'])} },
  )
  if (!results.verify || !results.verify.green) throw new Error('Verify failed: not green — ' + (results.verify && (results.verify.failing || []).join(', ')))
  done.add('Verify')
  await checkpoint('Verify')
}`;

const pathGapBlock = !withCycle ? '' : `
phase('PathGap')
if (done.has('PathGap')) {
  log('PathGap already complete (resumed)')
} else {
  // Close test gaps for code paths the ACs never specified (decide-or-justify, hard-fail).
  let closed = false, last = null
  for (let round = 1; round <= 3 && !closed; round++) {
    last = await agent(
      \`\${inWorktree('pathgap')}

PATH-GAP: the ACs do NOT cover every code path. Steps:
1. Run Jest with BRANCH coverage; intersect with the CHANGED lines (git diff vs \${BASE || 'the base branch'}) to find uncovered branches introduced by this change.
2. For EACH uncovered changed branch, do ONE: (a) add a unit/integration test that meaningfully exercises AND asserts it, or (b) if it is genuinely unreachable/defensive, record an explicit justification in implementation-notes/pathgap.html.
3. Re-run coverage. There must be NO silent gaps — every uncovered changed branch is either tested or justified.
Do NOT delete/alter source branches just to raise coverage. Commit new tests + notes.\`,
      { label: \`pathgap:r\${round}\`, phase: 'PathGap',
        schema: ${SCHEMA({ closed: { type: 'boolean' }, uncovered: { type: 'number' }, tested: { type: 'number' }, justified: { type: 'number' }, summary: { type: 'string' } }, ['closed'])} },
    )
    closed = last && last.closed
  }
  if (!closed) throw new Error('PathGap failed: uncovered changed-code branches remain after 3 rounds — ' + (last && last.summary || ''))
  results.pathGap = last
  done.add('PathGap')
  await checkpoint('PathGap')
}`;

const reVerifyBlock = !withCycle ? '' : `
phase('ReVerify')
if (done.has('ReVerify')) {
  log('ReVerify already complete (resumed)')
} else {
  results.reVerify = await agent(
    \`\${inWorktree('reverify')}

RE-VERIFY: after IMPROVE/SIMPLIFY (CodeGate), re-run the FULL test suite + branch coverage for the changes on \${BRANCH} vs \${BASE || 'the base branch'}. Everything green before must STILL be green and coverage must not have regressed. If a refactor broke anything, STOP and report; do NOT weaken tests.\`,
    { label: 'reverify', phase: 'ReVerify',
      schema: ${SCHEMA({ green: { type: 'boolean' }, regressions: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, ['green'])} },
  )
  if (!results.reVerify || !results.reVerify.green) throw new Error('ReVerify failed: regression after improve/simplify — ' + (results.reVerify && (results.reVerify.regressions || []).join(', ')))
  done.add('ReVerify')
  await checkpoint('ReVerify')
}`;

// Assemble the core (work + gates/cycle) in the right order.
const coreBlocks = withCycle
  ? [redBlock, workBlocks, verifyBlock, pathGapBlock, codeGateBlock, reVerifyBlock].join('\n')
  : [workBlocks, codeGateBlock, testGateBlock].join('\n');

const src = `// AUTO-GENERATED by scaffold-workflow.cjs — DO NOT edit the boilerplate.
// Edit ONLY the \`TODO:\` agent prompts in the work phases below.
// Regenerate with the same flags to update boilerplate (use --force).
//
// Conductor rules: pure JS only — no fs/git, no Date.now()/Math.random().
// All side-effects happen inside agent() subagents.

export const meta = {
  name: '${name}',
  description: '${desc.replace(/'/g, "\\'")}',
  phases: [
${metaPhases}
  ],
}

const NAME     = '${name}'
const STATE    = \`.workflows/state/\${NAME}.json\`
const BRANCH   = (args && args.branch) ? args.branch : \`wf/\${NAME}\`
const BASE     = (args && args.base) ? args.base : '${base === true ? '' : base}'
const WORKTREE = \`.worktrees/\${NAME}\`
const TICKET   = (args && args.ticket) ? args.ticket : ${withTicket ? 'null' : 'null'}

const prior = (args && args.results) ? args.results : {}
const done  = new Set((args && args.phasesDone) ? args.phasesDone : [])
const results = { ...prior }

// Per-worker instruction. \`slot\` makes the notes file UNIQUE so parallel / multiple agents
// never clobber each other. For a parallel fan-out, pass a slot unique per item (e.g. \`phase-\${i}\`).
function inWorktree(slot) {
  return \`Work ONLY inside the git worktree at \${WORKTREE} (run \\\`cd \${WORKTREE}\\\` first; it is on \` +
    \`branch \${BRANCH}). Do NOT edit any file outside \${WORKTREE}. Commit your changes there.\\n\\n\` +
    \`As you work, maintain a notes file UNIQUE to you at implementation-notes/\${slot}.html in the \` +
    \`worktree (mkdir -p the dir; create the file if missing; APPEND — never clobber). Capture what a \` +
    \`reviewer should know about how the implementation interprets or diverges from the spec: Design \` +
    \`decisions (where the spec was ambiguous), Deviations (intentional departures + why), Tradeoffs \` +
    \`(alternatives considered + why this one), Open questions (anything to confirm or revise).\`
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
    { label: \`checkpoint:\${phaseTitle}\`, phase: phaseTitle,
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
  git worktree add "\${WORKTREE}" -b "\${BRANCH}" \${BASE}
fi
[ -e "\${WORKTREE}/node_modules" ] || [ ! -d "\$ROOT/node_modules" ] || ln -s "\$ROOT/node_modules" "\${WORKTREE}/node_modules"
test -d "\${WORKTREE}" && echo OK\`,
    { label: 'setup:worktree', phase: 'Setup',
      schema: { type: 'object', additionalProperties: false, required: ['ready'], properties: { ready: { type: 'boolean' }, worktree: { type: 'string' }, branch: { type: 'string' } } } },
  )
  done.add('Setup')
  await checkpoint('Setup')
}
${briefBlock}
${coreBlocks}
${docsGateBlock}
${prBlock}
${ticketUpdateBlock}

return { workflow: NAME, status: 'complete', branch: BRANCH, worktree: WORKTREE, ticket: TICKET, phasesDone: [...done], results }
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, src);
console.log(`Generated ${out}`);
console.log(`Phases: ${phaseOrder.join(' → ')}`);
console.log(`Next: edit the TODO agent prompts in the work phases, then launch via the Workflow tool.`);

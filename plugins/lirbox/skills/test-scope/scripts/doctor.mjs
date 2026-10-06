// doctor: the per-change self-check in one call (CI, pre-commit, reviewer). Aggregates the other subcommands and
// ends with a numbered list of actions; exit 0 only when that list is empty. Not measurable fails closed unless
// --allow-unmeasured.
import fs from 'node:fs';
import path from 'node:path';
import { cmdChangecov } from './changecov.mjs';
import { cmdMutate } from './mutate.mjs';

const head = (text, n = 8) => text.split('\n').filter(Boolean).slice(0, n).join('\n');

function validate(H) {
  const out = [];
  const { cfg } = H;
  for (const [k, v] of [['noTests', cfg.noTests], ['runAll', cfg.runAll], ['graphCuts', cfg.graphCuts]]) if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) out.push(`${k} must be an array of glob strings`);
  for (const p of Object.values(cfg.packages)) {
    if (!fs.existsSync(path.join(H.root, p.dir))) out.push(`package ${p.name}: dir "${p.dir}" does not exist`);
    if (p.runner === 'custom' && !p.cmd) out.push(`package ${p.name}: runner "custom" needs "cmd"`);
    const c = p.coverage;
    if (c !== undefined && (typeof c !== 'object' || (!c.file && !c.cmd) || (c.format && !['istanbul', 'lcov', 'py-json', 'go'].includes(c.format)))) out.push(`package ${p.name}: "coverage" needs {file and/or cmd, format: istanbul|lcov|py-json|go}`);
  }
  for (const [n, part] of Object.entries(cfg.parts)) if (!part.paths.length) out.push(`part ${n}: no "paths": it can only be reached through --part`);
  return out;
}

export async function cmdDoctor(a, { root, Usage, capture, load }) {
  const steps = [];
  const actions = [];
  const log = (s) => console.log(s);
  const mark = (status, name, detail, action) => { steps.push({ status, name, detail }); log(`[${status.padEnd(4)}] ${name}${detail && !detail.includes('\n') ? `: ${detail}` : ''}`); if (detail && detail.includes('\n')) log(detail.replace(/^\s+/, '').split('\n').map((l) => `      ${l.trim()}`).join('\n')); if (action) actions.push(action); };
  log(`doctor: ${root}`);
  const { cfg, H, error } = load();
  if (error) { mark('FAIL', 'config', error, `fix the config: ${error}`); return finish(); }
  const problems = [...validate(H), ...cfg.warnings.map((w) => `warning: ${w}`)];
  const hard = problems.filter((p) => !p.startsWith('warning:'));
  mark(hard.length ? 'FAIL' : problems.length ? 'WARN' : 'ok', 'config', problems.length ? problems.join('\n') : `${Object.keys(cfg.packages).length} package(s), ${Object.keys(cfg.parts).length} part(s)`, hard.length ? `repair ${path.relative(root, cfg.file)}: ${hard.join('; ')}` : null);

  const cov = capture(() => H.coverageCmd());
  mark(cov.code ? 'FAIL' : 'ok', 'coverage (drift)', cov.code ? head(cov.text, 10) : cov.text.split('\n').filter((l) => /^test files|clean/.test(l)).join(' | '),
    cov.code ? 'run `test-scope coverage` and fix: give every test file a part (or graphOnly), delete dead globs, own modules behind a graphCut' : null);

  const ws = H.workspace();
  if (ws) {
    const risks = ws.staleRisks();
    mark(risks.length ? 'WARN' : 'ok', 'workspace (build freshness)', risks.length
      ? risks.map((r) => `stale-build risk: ${r.pkg} exports its build (${r.entry}) and ${r.dependents.length <= 4 ? r.dependents.join(', ') : `${r.dependents.slice(0, 4).join(', ')} +${r.dependents.length - 4}`} ${r.dependents.length === 1 ? 'has' : 'have'} no source alias for it: \`run\` prebuilds ${r.pkg} first, a bare runner call tests its last build`).join('\n')
      : `${ws.pkgs.size} workspace package(s); every dependent sees its upstream's sources`);
  }

  if (fs.existsSync(path.join(root, '.test-scope/rules.source.json'))) {
    const r = capture(() => H.rulesCmd({ check: true }));
    mark(r.code ? 'FAIL' : 'ok', 'rules --check', r.text.split('\n')[0], r.code ? 'run `test-scope rules --write` (then review the diff of .opencodereview/rule.json)' : null);
  } else mark('skip', 'rules --check', 'no .test-scope/rules.source.json');

  if (!a.changed) { log('skip: change checks (pass --changed [base] [--to ref] for uncovered files, changecov and a mutate sample)'); return finish(); }
  const unmeasured = (what, text) => {
    const allowed = a['allow-unmeasured'];
    mark(allowed ? 'WARN' : 'FAIL', what, `not measurable: ${text}`, allowed ? null : `make ${what} measurable (see message) or pass --allow-unmeasured for this repo; a change that cannot be measured is not verified`);
  };

  // uncovered changed files
  const s = H.plan(a);
  if (s.sel.uncovered.length) mark('FAIL', 'selection covers every changed file', `${s.sel.uncovered.length} file(s) select no test and are not in noTests:\n${s.sel.uncovered.map((f) => `      ${f}`).join('\n')}`, `for each uncovered file, add it to a part's paths (with the test that exercises it) or to noTests: ${s.sel.uncovered.join(', ')}`);
  else mark('ok', 'selection covers every changed file', `${s.meta.changedFiles.length} changed file(s), ${s.sel.entries.length} test file(s) selected${Object.values(s.sel.graph).includes('runtime') ? '; graph resolved by the runner at run time (use --resolve for an exact exit-3 check)' : ''}`);
  if (s.sel.runAll) log('      run-all trigger hit: the whole suite is the selection (changecov/mutate then run all of it; use --no-changecov --no-mutate to skip)');

  // changecov
  let cc = null;
  if (a['no-changecov']) mark('skip', 'changecov', '--no-changecov');
  else {
    log(`[....] changecov: running ${s.sel.entries.length} selected test file(s) with coverage (timeout ${a.timeout || 1800}s) ...`);
    cc = await capture(() => cmdChangecov(a, H, { quiet: true }));
    if (cc.code === 0) mark('ok', 'changecov', cc.text.split('\n').filter((l) => /^changed functions|^rule:|no changed source/.test(l)).join(' | '));
    else if (cc.code === 4) unmeasured('changecov', cc.text.split('\n').find((l) => /not measurable/.test(l)).replace(/^changecov: not measurable: /, ''));
    else mark('FAIL', 'changecov', head(cc.text.split('\n').filter((l) => /NOT RUN|NOT IN|uncovered changed|rule:|selected tests failed|failed|FAIL/.test(l)).join('\n'), 10), 'add or extend a test that executes the changed functions listed above (or select the test that already does: parts paths); then re-run changecov');
  }
  // mutate sample
  if (a['no-mutate']) mark('skip', 'mutate (sample)', '--no-mutate');
  else {
    log(`[....] mutate (sample): up to ${a['max-mutants'] || 3} mutant(s), each a selected run (timeout ${a.timeout || 600}s)${a.to ? '' : '; uncommitted targets are mutated in place, originals journaled in the git dir'} ...`);
    const m = await capture(() => cmdMutate({ ...a, 'max-mutants': a['max-mutants'] || '3', 'allow-dirty': true }, H, { skipBaseline: !!cc && cc.code === 0 }));
    if (m.code === 0) mark('ok', 'mutate (sample)', m.text.split('\n').filter((l) => /^summary|no changed|no changed function|changed by something else/.test(l)).join(' | '));
    else if (m.code === 2) mark('FAIL', 'mutate (sample)', head(m.text.split('\n').filter((l) => /changed by something else/.test(l)).join('\n'), 10), 'a file was edited while mutate ran and still holds a mutant (TSMUT): remove that line or restore the original from the journal named above, then re-run doctor');
    else if (m.code === 4) unmeasured('mutate', m.text.split('\n').find((l) => /not measurable/.test(l)) || 'no function reader');
    else mark('FAIL', 'mutate (sample)', head(m.text.split('\n').filter((l) => /SURVIVED|refusing|RED|summary|TIMEOUT|changed by something else/.test(l)).join('\n'), 10), 'a changed function can be broken without any selected test failing: write/extend the test that asserts its behaviour, or select the test that already covers it');
  }
  return finish();

  function finish() {
    if (!actions.length) { log('\ndoctor: clean'); return 0; }
    log('\nactions:');
    actions.forEach((x, i) => log(` ${i + 1}. ${x}`));
    return 1;
  }
}

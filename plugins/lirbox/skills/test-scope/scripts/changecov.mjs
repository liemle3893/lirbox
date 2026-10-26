// changecov: run the SELECTED tests with coverage and intersect executed lines with the diff's changed lines.
// Also owns `changedTargets` (diff -> changed functions per file), which `mutate` shares.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAsync, lastError } from './exec.mjs';
import { findFunctions, changedFunctions, langOf, parseDiffLines, rangeText } from './funcs.mjs';

// ───────────── changed targets ─────────────
/** -> {items:[{file, pkg, rel, lang, text, funcs, changed, moduleLevel, lines}], unsupported:[file], exempt:n} */
export function changedTargets(H, base, to, files, deleted) {
  const diff = H.gitOk(['diff', '-U0', '--no-color', '--no-ext-diff', base, ...(to ? [to] : []), '--']) || '';
  const lm = parseDiffLines(diff);
  if (!to) for (const f of H.lines(H.gitOk(['ls-files', '--others', '--exclude-standard']) || '')) {
    const n = fs.existsSync(path.join(H.root, f)) ? fs.readFileSync(path.join(H.root, f), 'utf8').split('\n').length : 0;
    lm.set(f, { lines: new Set(Array.from({ length: n }, (_, i) => i + 1)), touch: new Set() });
  }
  const items = [], unsupported = [];
  let exempt = 0;
  for (const file of files) {
    if (deleted.has(file)) continue;
    if (H.isTestFile(file) || H.MANIFEST.test(file) || (H.matchAny(file, H.cfg.noTests) && !Object.values(H.cfg.parts).some((p) => H.matchesPaths(file, p.paths)))) { exempt++; continue; }
    const p = H.pkgOf(file);
    const lang = langOf(file);
    if (!p || !lang) { unsupported.push(file); continue; }
    const text = to ? H.gitOk(['show', `${to}:${file}`]) : fs.readFileSync(path.join(H.root, file), 'utf8');
    if (text === null) continue;
    const d = lm.get(file) || { lines: new Set(), touch: new Set() };
    const funcs = findFunctions(text, lang);
    const { functions, moduleLevel } = changedFunctions(funcs, d.lines, d.touch);
    items.push({ file, pkg: p.pkg, rel: p.rel, lang, text, funcs, changed: functions, moduleLevel, lines: d.lines });
  }
  return { items, unsupported, exempt };
}

// ───────────── coverage formats ─────────────
const norm = (H, pkg, p) => path.relative(H.root, path.isAbsolute(p) ? p : path.join(H.root, pkg.dir, p)).split(path.sep).join('/');
const hit = (m, line, n) => m.set(line, Math.max(m.get(line) ?? 0, n));

/** Every format -> Map<repoRelPath, {lines: Map<line, hits>, fns: [{start, hits}] | null}>. */
export function parseCoverage(H, pkg, format, text) {
  const out = new Map();
  const entry = (p) => { const k = norm(H, pkg, p); if (!out.has(k)) out.set(k, { lines: new Map(), fns: null }); return out.get(k); };
  if (format === 'istanbul') {
    for (const [p, c] of Object.entries(JSON.parse(text))) {
      const e = entry(c.path || p);
      for (const [id, loc] of Object.entries(c.statementMap || {})) hit(e.lines, loc.start.line, c.s[id] ?? 0);
      e.fns = Object.entries(c.fnMap || {}).map(([id, f]) => ({ start: (f.decl || f.loc).start.line, hits: c.f[id] ?? 0 }));
    }
  } else if (format === 'py-json') {
    for (const [p, c] of Object.entries(JSON.parse(text).files || {})) {
      const e = entry(p);
      for (const l of c.executed_lines || []) hit(e.lines, l, 1);
      for (const l of c.missing_lines || []) hit(e.lines, l, 0);
    }
  } else if (format === 'lcov') {
    let e = null;
    for (const l of text.split('\n')) {
      if (l.startsWith('SF:')) e = entry(l.slice(3).trim());
      else if (e && l.startsWith('DA:')) { const [ln, n] = l.slice(3).split(','); hit(e.lines, +ln, +n); }
      else if (l.startsWith('end_of_record')) e = null;
    }
  } else if (format === 'go') {
    const mod = /^module\s+(\S+)/m.exec(fs.readFileSync(path.join(H.root, pkg.dir, 'go.mod'), 'utf8'))?.[1];
    for (const l of text.split('\n')) {
      const m = /^(.+):(\d+)\.\d+,(\d+)\.\d+ \d+ (\d+)$/.exec(l);
      if (!m) continue;
      const file = mod && m[1].startsWith(mod + '/') ? m[1].slice(mod.length + 1) : m[1];
      const e = entry(file);
      for (let k = +m[2]; k <= +m[3]; k++) hit(e.lines, k, +m[4]);
    }
  } else throw new Error(`unknown coverage format "${format}" (istanbul, lcov, py-json, go)`);
  return out;
}

/** true / false, or null when the function has no executable line to judge by. */
export function fnExecuted(cov, f) {
  if (cov.fns) {
    const c = cov.fns.filter((x) => x.start >= f.startLine && x.start <= f.bodyOpenLine);
    if (c.length) return c.some((x) => x.hits > 0);
  }
  const lo = f.bodyOpenLine === f.endLine ? f.startLine : f.bodyOpenLine + 1;
  let seen = false;
  for (let l = lo; l <= f.endLine; l++) if (cov.lines.has(l)) { seen = true; if (cov.lines.get(l) > 0) return true; }
  return seen ? false : null;
}

// ───────────── how each runner produces coverage ─────────────
function coveragePlan(H, run, outDir, changedRels) {
  const { pkg } = run;
  const base = H.runArgv(run);
  if (!base) return { error: `no runner command for package ${pkg.name} (runner "${pkg.runner}")` };
  const c = pkg.coverage;
  if (c) {
    const file = c.file ? (path.isAbsolute(c.file) ? c.file : path.join(H.root, pkg.dir, c.file)) : path.join(outDir, 'coverage.out');
    let argv = base;
    if (c.cmd) {
      const t = /\{(files|tests|related)\}/.test(c.cmd) ? c.cmd : `${c.cmd} {files}`;
      argv = H.fill(t, { related: run.related, tests: run.tests, files: [...run.related, ...run.tests] }).map((w) => w.replaceAll('{out}', file));
    }
    return { argv, file, format: c.format || 'lcov' };
  }
  switch (pkg.runner) {
    case 'vitest': return { argv: [...base, '--coverage.enabled=true', '--coverage.provider=v8', '--coverage.reporter=json', `--coverage.reportsDirectory=${outDir}`, ...changedRels.map((r) => `--coverage.include=${r}`)], file: path.join(outDir, 'coverage-final.json'), format: 'istanbul', hint: 'install @vitest/coverage-v8 next to vitest' };
    case 'jest': return { argv: [...base, '--coverage', '--coverageReporters=json', `--coverageDirectory=${outDir}`, ...changedRels.map((r) => `--collectCoverageFrom=${r}`)], file: path.join(outDir, 'coverage-final.json'), format: 'istanbul' };
    case 'pytest': return { argv: [...base, '--cov=.', `--cov-report=json:${path.join(outDir, 'coverage.json')}`], file: path.join(outDir, 'coverage.json'), format: 'py-json', hint: 'pip install pytest-cov' };
    case 'go': { const i = base.indexOf('test'); const argv = [...base]; argv.splice(i < 0 ? argv.length : i + 1, 0, `-coverprofile=${path.join(outDir, 'cover.out')}`, '-coverpkg=./...'); /* -coverpkg: code reached from other packages' tests counts too */ return { argv, file: path.join(outDir, 'cover.out'), format: 'go' }; }
    default: return { error: `runner "${pkg.runner}" has no built-in coverage: set packages.${pkg.name}.coverage {"file": "...", "format": "lcov|istanbul|py-json|go", "cmd": "... {files} ... {out}"} (references/parts-schema.md)` };
  }
}

// ───────────── command ─────────────
const sec = (v, d) => (v === undefined ? d : Math.max(1, parseFloat(v)) * 1000);

/** Exit: 0 ok, 1 below threshold / selected tests failed, 4 not measurable. opts.quiet: no live test output (doctor). */
export async function cmdChangecov(a, H, opts = {}) {
  const plan = H.plan(a);
  const t = changedTargets(H, plan.meta.base, a.to, plan.meta.changedFiles, plan.deleted);
  const say = (s) => console.log(s);
  if (!t.items.length) {
    if (t.unsupported.length) { say(`changecov: not measurable: changed source file(s) in a language without a function/coverage reader (${t.unsupported.join(', ')}). Own them with a part and a check instead.`); return 4; }
    say(`changecov: no changed source file to measure (${t.exempt} exempt: tests, docs, manifests)`);
    return 0;
  }
  const threshold = a.threshold === undefined ? null : parseFloat(a.threshold);
  if (threshold !== null && !(threshold >= 0 && threshold <= 100)) throw new H.Usage('--threshold is a percentage of changed executable lines, 0-100');
  const covs = new Map(); // repo path -> cov (merged across packages)
  let testsFailed = false, stoppedRunning = null;
  for (const run of plan.runs) {
    const mine = t.items.filter((i) => i.pkg === run.pkg);
    if (!mine.length) continue;
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-cov-'));
    try {
      const cp = coveragePlan(H, run, outDir, mine.map((i) => i.rel));
      if (cp.error) { say(`changecov: not measurable: ${cp.error}`); return 4; }
      const argv = [...H.wrapperArgv(run.pkg), ...cp.argv];
      say(`changecov: package ${run.pkg.name}: ${run.tests.length} test file(s), ${run.related.length} related source(s)\n$ ${argv.join(' ').slice(0, 400)}`);
      if (a['dry-run']) continue;
      fs.rmSync(cp.file, { force: true }); // never read a stale file from an earlier run
      fs.mkdirSync(path.dirname(cp.file), { recursive: true });
      const r = await runAsync(argv, path.join(H.root, run.pkg.dir), { timeoutMs: sec(a.timeout, 1_800_000), stream: !opts.quiet });
      if (r.timedOut) { stoppedRunning = `timed out after ${(r.ms / 1000).toFixed(0)}s`; }
      if (r.code !== 0) testsFailed = true;
      if (!fs.existsSync(cp.file)) {
        say(`changecov: not measurable: package ${run.pkg.name}: the runner wrote no coverage file (${path.relative(H.root, cp.file)}); ${lastError(r.out)}${cp.hint ? `; ${cp.hint}` : ''}`);
        return 4;
      }
      try { for (const [k, v] of parseCoverage(H, run.pkg, cp.format, fs.readFileSync(cp.file, 'utf8'))) covs.set(k, v); }
      catch (e) { say(`changecov: not measurable: cannot read ${cp.format} coverage from ${path.relative(H.root, cp.file)}: ${e.message}`); return 4; }
    } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
  }
  if (a['dry-run']) return 0;
  // ── intersect ──
  const files = [];
  let fnTotal = 0, fnHit = 0, ln = 0, lnHit = 0;
  for (const i of t.items) {
    const cov = covs.get(i.file);
    const fns = i.changed.map((f) => ({ name: f.name, lines: `${f.startLine}-${f.endLine}`, executed: cov ? fnExecuted(cov, f) : false }));
    const uncovered = [], executable = [];
    for (const l of [...i.lines].sort((x, y) => x - y)) if (cov && cov.lines.has(l)) { executable.push(l); if (!(cov.lines.get(l) > 0)) uncovered.push(l); }
    files.push({ file: i.file, inReport: !!cov, functions: fns, moduleLevel: i.moduleLevel.length, executableLines: executable.length, uncoveredLines: uncovered });
    for (const f of fns) if (f.executed !== null) { fnTotal++; if (f.executed) fnHit++; }
    ln += executable.length; lnHit += executable.length - uncovered.length;
  }
  const linePct = ln ? Math.round((1000 * lnHit) / ln) / 10 : 100;
  const missingFns = files.flatMap((f) => f.functions.filter((x) => x.executed === false).map((x) => `${f.file}:${x.lines} ${x.name}`));
  const pass = !testsFailed && (threshold === null ? !missingFns.length && files.every((f) => f.inReport) : linePct >= threshold);
  if (a.json) {
    console.log(JSON.stringify({ selectedTests: plan.runs.reduce((n, r) => n + r.tests.length, 0), files, changedFunctions: fnTotal, executedFunctions: fnHit, changedExecutableLines: ln, coveredLines: lnHit, linePercent: linePct, threshold, testsFailed, pass }, null, 2));
    return pass ? 0 : 1;
  }
  for (const f of files) {
    say(`${f.file}${f.inReport ? '' : '   NOT IN COVERAGE REPORT: no selected test loads it'}`);
    for (const x of f.functions) say(`  ${x.executed === null ? 'n/a     ' : x.executed ? 'executed ' : 'NOT RUN  '} ${x.name} (lines ${x.lines})${x.executed === null ? '  no executable statement' : ''}`);
    if (f.moduleLevel) say(`  ${f.moduleLevel} changed line(s) outside any function (module level)`);
    if (f.uncoveredLines.length) say(`  uncovered changed lines: ${rangeText(f.uncoveredLines)}`);
  }
  for (const u of t.unsupported) say(`not measured (no reader for this language): ${u}`);
  if (stoppedRunning) say(`warning: the selected tests ${stoppedRunning}: coverage may be partial`);
  say(`changed functions: ${fnTotal}, executed: ${fnHit}   changed executable lines: ${ln}, covered: ${lnHit} (${linePct}%)   selected tests failed: ${testsFailed ? 'YES' : 'no'}`);
  say(threshold === null ? `rule: every changed function executed at least once -> ${pass ? 'PASS' : 'FAIL'}${missingFns.length ? ` (${missingFns.length} not executed by any selected test: the change is not really tested)` : ''}` : `rule: changed-line coverage >= ${threshold}% -> ${pass ? 'PASS' : 'FAIL'}`);
  return pass ? 0 : 1;
}

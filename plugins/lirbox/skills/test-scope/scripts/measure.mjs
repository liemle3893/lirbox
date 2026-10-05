// measure: one metrics record per call, appended to .test-scope/metrics.jsonl; `--compare A B` prints the lift.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// [key path, label, "lower"/"info"]: lower is better; info is reported without a verdict.
const METRICS = [
  ['selection.median', 'selection median (files)', 'lower'], ['selection.p90', 'selection p90 (files)', 'lower'], ['selection.max', 'selection max (files)', 'lower'],
  ['selection.medianPercent', 'selection median (% of suite)', 'lower'], ['selection.p90Percent', 'selection p90 (% of suite)', 'lower'],
  ['runAllRate', 'run-all rate', 'lower'], ['uncoveredRate', 'uncovered-change rate', 'lower'],
  ['parts', 'parts', 'info'], ['drift.unowned', 'unowned test files', 'lower'], ['drift.dead', 'dead globs', 'lower'], ['drift.cutUnowned', 'cut-unowned modules', 'lower'],
  ['misses.count', 'backstop misses (last known)', 'lower'], ['wallSeconds', 'wall time of a selected run (s)', 'lower'],
];
const dig = (o, k) => k.split('.').reduce((x, p) => (x == null ? null : x[p]), o);
const round = (x) => Math.round(x * 1000) / 1000;

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

function sha(root) {
  const g = (args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
  return { sha: g(['rev-parse', '--short', 'HEAD']) || null, dirty: !!g(['status', '--porcelain', '--untracked-files=no']) };
}

export function compare(records, A, B) {
  const last = (label) => [...records].reverse().find((r) => r.label === label);
  const ra = last(A), rb = last(B);
  if (!ra || !rb) return { error: `no record labelled ${!ra ? A : B} (labels present: ${[...new Set(records.map((r) => r.label).filter(Boolean))].join(', ') || 'none'})` };
  const rows = METRICS.map(([key, label, dir]) => {
    const x = dig(ra, key), y = dig(rb, key);
    if (typeof x !== 'number' || typeof y !== 'number') return { key, label, a: x, b: y, verdict: 'n/a' };
    const delta = round(y - x);
    const pct = x === 0 ? null : round((100 * (y - x)) / x);
    return { key, label, a: x, b: y, delta, pct, verdict: dir === 'info' ? 'info' : delta < 0 ? 'better' : delta > 0 ? 'worse' : 'same' };
  });
  const unlike = [];
  if (ra.commits !== rb.commits) unlike.push(`--commits ${ra.commits} vs ${rb.commits}`);
  if (!!ra.resolved !== !!rb.resolved) unlike.push(`--resolve ${!!ra.resolved} vs ${!!rb.resolved}`);
  return { A: { label: A, sha: ra.sha, ts: ra.ts }, B: { label: B, sha: rb.sha, ts: rb.ts }, rows, unlike, lowerBound: !!(ra.selection?.lowerBoundCommits || rb.selection?.lowerBoundCommits) };
}

export async function cmdMeasure(a, H, { capture }) {
  const file = path.resolve(H.root, a.metrics || '.test-scope/metrics.jsonl');
  if (a.compare) {
    const r = compare(read(file), ...a.compare);
    if (r.error) throw new H.Usage(r.error);
    if (a.json) { console.log(JSON.stringify(r, null, 2)); return 0; }
    console.log(`lift ${r.B.label} (${r.B.sha || '?'}) vs ${r.A.label} (${r.A.sha || '?'})   [${path.relative(H.root, file)}]`);
    for (const x of r.rows) {
      if (x.verdict === 'n/a') { console.log(`  ${x.label.padEnd(34)} n/a (${x.a ?? '-'} -> ${x.b ?? '-'})`); continue; }
      console.log(`  ${x.label.padEnd(34)} ${String(x.a).padStart(8)} -> ${String(x.b).padStart(8)}  ${(x.delta > 0 ? '+' : '') + x.delta}${x.pct === null ? '' : ` (${x.pct > 0 ? '+' : ''}${x.pct}%)`}  ${x.verdict}`);
    }
    if (r.unlike.length) console.log(`  warning: not like with like (${r.unlike.join(', ')}): re-measure both with the same flags before claiming a lift`);
    const n = (v) => r.rows.filter((x) => x.verdict === v).length;
    console.log(`better ${n('better')}, worse ${n('worse')}, same ${n('same')}${r.lowerBound ? '   (a selection figure is a lower bound: vitest/jest not resolved, rerun measure with --resolve)' : ''}`);
    return 0;
  }
  const n = parseInt(a.commits || '20', 10);
  const { rows, summary } = H.replayStats(n, !!a.resolve);
  const cov = H.coverageStats();
  const prev = read(file);
  let misses = null;
  if (a.results) {
    const r = await capture(() => H.missesCmd({ ...a, json: true }));
    let j; try { j = JSON.parse(r.text); } catch { j = null; }
    if (!j) throw new H.Usage(`misses --results could not be read: ${r.text.split('\n')[0]}`);
    misses = { count: j.failing.filter((f) => f.verdict === 'MISS').length, unknown: j.failing.filter((f) => f.verdict === 'UNKNOWN').length + j.unmapped.length, fresh: true, ts: new Date().toISOString() };
  } else {
    const p = [...prev].reverse().find((r) => r.misses);
    misses = p ? { ...p.misses, fresh: false } : null;
  }
  const wall = a.wall === undefined ? null : parseFloat(a.wall);
  if (wall !== null && !(wall >= 0)) throw new H.Usage('--wall is seconds');
  const rec = {
    ts: new Date().toISOString(), label: a.label || null, ...sha(H.root), commits: rows.length, resolved: !!a.resolve,
    selection: { median: summary.median, p90: summary.p90, max: summary.max, medianPercent: summary.medianPercent, p90Percent: summary.p90Percent, maxPercent: summary.maxPercent, totalTestFiles: summary.totalTestFiles, lowerBoundCommits: summary.lowerBoundCommits },
    runAllRate: rows.length ? round(summary.runAllCommits / rows.length) : 0,
    uncoveredRate: rows.length ? round(summary.uncoveredCommits / rows.length) : 0,
    parts: Object.keys(H.cfg.parts).length,
    drift: { unowned: cov.unowned.length, dead: cov.dead.length, problems: cov.problems.length, cutUnowned: cov.cut.problems.length },
    misses, wallSeconds: wall,
  };
  if (a.json) console.log(JSON.stringify(rec, null, 2));
  else {
    console.log(`measure${rec.label ? ` [${rec.label}]` : ''} @ ${rec.sha || 'no-git'}${rec.dirty ? ' (dirty tree)' : ''}: last ${rec.commits} first-parent commit(s)`);
    console.log(`  selection: median ${rec.selection.median}, p90 ${rec.selection.p90}, max ${rec.selection.max} of ${rec.selection.totalTestFiles} file(s)${rec.selection.lowerBoundCommits ? `   '+' lower bound on ${rec.selection.lowerBoundCommits} commit(s): pass --resolve` : ''}`);
    console.log(`  run-all rate ${rec.runAllRate}, uncovered-change rate ${rec.uncoveredRate}, parts ${rec.parts}`);
    console.log(`  drift: unowned ${rec.drift.unowned}, dead globs ${rec.drift.dead}, problems ${rec.drift.problems}, cut-unowned ${rec.drift.cutUnowned}`);
    console.log(`  backstop misses: ${misses ? `${misses.count} (unknown ${misses.unknown})${misses.fresh ? '' : ' (last known, not re-measured: pass --results)'}` : 'not measured (pass --results <junit|vitest json|go json> after a backstop run)'}`);
    console.log(`  wall time of a selected run: ${wall === null ? 'not measured (pass --wall <seconds> from a timed run)' : `${wall}s`}`);
  }
  if (!a['no-write']) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(rec) + '\n');
    if (!a.json) console.log(`appended to ${path.relative(H.root, file)}`);
  }
  return 0;
}

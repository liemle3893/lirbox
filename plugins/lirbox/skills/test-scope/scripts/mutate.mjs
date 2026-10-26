// mutate: function-entry mutation of the CHANGED functions, to prove the selected tests would notice the change
// (default) or that an excluded test is relevant (--prove-irrelevant). The module still imports/compiles: only the
// body of one function is made to throw. Files are always restored: finally blocks, signal handlers, an exit hook,
// and an on-disk journal that the next run replays after a SIGKILL.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAsync, killActive } from './exec.mjs';
import { changedTargets } from './changecov.mjs';
import { mutateText } from './funcs.mjs';

const applied = new Map(); // abs path -> {orig, mutated}, while a mutant is on disk
let journal = null;

/** Inside the repo's git dir (survives a reboot, unlike a tmpfs /tmp); OS temp dir only outside git. */
const journalFile = (H) => {
  const gd = (H.gitOk(['rev-parse', '--absolute-git-dir']) || '').trim();
  return gd ? path.join(gd, 'test-scope-mutate.json') : path.join(os.tmpdir(), `test-scope-mutate-${crypto.createHash('sha1').update(H.root).digest('hex').slice(0, 12)}.json`);
};
const journalWrite = () => { if (journal) { if (applied.size) fs.writeFileSync(journal.file, JSON.stringify({ root: journal.root, files: Object.fromEntries(applied) })); else fs.rmSync(journal.file, { force: true }); } };
const readOr = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

/** The text mutateText inserted (one insertion, carrying the run-unique marker): mutated minus orig. */
function insertion(orig, mutated) {
  let p = 0;
  while (p < orig.length && orig[p] === mutated[p]) p++;
  return mutated.slice(p, p + mutated.length - orig.length);
}

/**
 * Put one mutated file back. A file someone edited during the run is never overwritten: when it still holds our
 * inserted mutant text exactly once, only that insertion is removed and the other edit kept; otherwise it is left as is
 * (its original stays in the journal). -> 'restored' | 'restored-foreign' | 'untouched' (already original) | 'foreign'
 */
function putBack(f, { orig, mutated }) {
  const now = readOr(f);
  if (now === orig) return 'untouched';
  if (now === mutated) { fs.writeFileSync(f, orig); return 'restored'; }
  const ins = insertion(orig, mutated);
  if (now === null || !ins.includes('TSMUT:') || now.split(ins).length !== 2) return 'foreign';
  fs.writeFileSync(f, now.replace(ins, () => ''));
  return 'restored-foreign';
}

/** A foreign edit left a mutant on disk: cmdMutate turns this into exit 2 with its message (no process.exit mid-run). */
class ForeignEdit extends Error {}

/** Put every mutated file back; returns the paths it restored. Foreign edits are reported, never overwritten. */
export function restoreAll() {
  const done = [];
  for (const [f, e] of [...applied]) {
    try {
      const r = putBack(f, e);
      if (r === 'foreign') { console.error(`mutate: ${f} was changed by something else while mutated: NOT overwritten; its original is in ${journal && journal.file}`); continue; }
      if (r === 'restored-foreign') console.error(`mutate: ${f} was changed by something else while mutated: restored (foreign edit kept)`);
      applied.delete(f);
      if (r === 'restored' || r === 'restored-foreign') done.push(f);
    } catch { /* keep it in `applied`, the journal still has it */ }
  }
  try { journalWrite(); } catch { /* best effort */ }
  return done;
}

/** A previous run died without restoring (SIGKILL, power): replay its journal. -> {restored: [path], kept: path|null} */
export function recoverJournal(H) {
  const file = journalFile(H);
  if (!fs.existsSync(file)) return { restored: [], kept: null };
  const restored = [];
  let foreign = false;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j.root === H.root) for (const [f, e] of Object.entries(j.files)) { const r = putBack(f, e); if (r === 'restored' || r === 'restored-foreign') restored.push(f); if (r === 'foreign') foreign = true; }
  } catch { foreign = true; }
  if (!foreign) { fs.rmSync(file, { force: true }); return { restored, kept: null }; }
  const kept = `${file}.${Date.now()}`; // never lose an original: set it aside for a human
  fs.renameSync(file, kept);
  return { restored, kept };
}

let guarded = false;
function installGuards() {
  if (guarded) return;
  guarded = true;
  process.on('exit', () => { restoreAll(); });
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(sig, () => { killActive(); restoreAll(); process.exit(code); });
  }
  process.on('uncaughtException', (e) => { killActive(); restoreAll(); console.error(e && e.stack ? e.stack : e); process.exit(2); });
}

const sec = (v, d) => (v === undefined ? d : Math.max(1, parseFloat(v)) * 1000);

function globsArg(H, v) {
  const raw = v.startsWith('@') ? fs.readFileSync(path.resolve(H.root, v.slice(1)), 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean) : v.split(',').map((x) => x.trim()).filter(Boolean);
  if (!raw.length) throw new H.Usage('--prove-irrelevant needs test globs (comma list or @file)');
  return raw;
}

/** Exit: 0 every mutant caught / no selected-or-excluded relevance proven, 1 survivor / relevant test / refusal, 2 a foreign edit left a mutant on disk, 4 not measurable. */
export async function cmdMutate(a, H, opts = {}) {
  try { return await mutateRun(a, H, opts); }
  catch (e) { if (e instanceof ForeignEdit) { console.error(e.message); return 2; } throw e; }
}

async function mutateRun(a, H, opts) {
  const say = (s) => console.log(s);
  const rec = recoverJournal(H); // before anything reads the files
  if (rec.restored.length) say(`mutate: restored ${rec.restored.length} file(s) left mutated by an interrupted run: ${rec.restored.map((f) => path.relative(H.root, f)).join(', ')}`);
  if (rec.kept) say(`mutate: an interrupted run's journal names file(s) edited since; they were NOT touched. Originals: ${rec.kept}`);
  const plan = H.plan(a);
  const t = changedTargets(H, plan.meta.base, a.to, plan.meta.changedFiles, plan.deleted);
  if (!t.items.length) {
    if (t.unsupported.length) { say(`mutate: not measurable: changed source in a language without a function reader (${t.unsupported.join(', ')})`); return 4; }
    say('mutate: no changed source file to mutate'); return 0;
  }
  // ── targets ──
  const all = [], notes = [];
  for (const i of t.items) {
    for (const f of i.changed) { if (f.mutable) all.push({ item: i, f }); else notes.push(`not mutable: ${i.file}:${f.startLine} ${f.name} (${f.reason})`); }
    if (i.moduleLevel.length) notes.push(`not mutable: ${i.file}: ${i.moduleLevel.length} changed line(s) outside any function (use changecov)`);
  }
  for (const u of t.unsupported) notes.push(`not mutable (no function reader): ${u}`);
  if (!all.length) { notes.forEach(say); say('mutate: no changed function can be mutated'); return 0; }
  const max = a['max-mutants'] ? parseInt(a['max-mutants'], 10) : 12;
  if (!(max > 0)) throw new H.Usage('--max-mutants needs a positive number');
  // round-robin across files so a cap never drops a whole file
  const byFile = new Map();
  for (const m of all) { if (!byFile.has(m.item.file)) byFile.set(m.item.file, []); byFile.get(m.item.file).push(m); }
  const picked = [];
  for (let k = 0; picked.length < max && [...byFile.values()].some((v) => v.length > k); k++) for (const v of byFile.values()) if (v[k] && picked.length < max) picked.push(v[k]);
  const dropped = all.filter((m) => !picked.includes(m));
  const runId = Date.now().toString(36);
  const mutants = picked.map((m, n) => ({ ...m, n, marker: `TSMUT:${runId}:${n}`, label: `${m.item.file}:${m.f.startLine} ${m.f.name}` }));
  say(`mutate: ${all.length} changed function(s) -> ${mutants.length} mutant(s)${dropped.length ? `; DROPPED ${dropped.length} over the cap of ${max} (--max-mutants): ${dropped.map((m) => `${m.item.file}:${m.f.startLine} ${m.f.name}`).join(', ')}` : ''}`);
  notes.forEach(say);
  // ── safety ──
  const abs = (f) => path.join(H.root, f);
  const files = [...new Set(mutants.map((m) => m.item.file))];
  const dirty = H.lines(H.gitOk(['status', '--porcelain', '--', ...files]) || '');
  if (dirty.length && !a['allow-dirty']) { say(`mutate: refusing: target file(s) have uncommitted changes (${dirty.map((l) => l.slice(3)).join(', ')}). Commit and run with --to HEAD, or pass --allow-dirty (originals journaled in ${journalFile(H)}).`); return 1; }
  for (const f of files) if (fs.readFileSync(abs(f), 'utf8') !== mutants.find((m) => m.item.file === f).item.text) { say(`mutate: refusing: ${f} on disk differs from the ${a.to ? `ref ${a.to}` : 'diff'} it was analysed from`); return 1; }
  if (a['dry-run']) { for (const m of mutants) say(`  would mutate ${m.label}`); return 0; }
  installGuards();
  journal = { file: journalFile(H), root: H.root };
  const timeoutMs = sec(a.timeout, 600_000);
  const runFor = (pkg) => plan.runs.find((r) => r.pkg === pkg);
  const exec = (run, override) => {
    const argv = H.runArgv(override ? { ...run, ...override } : run);
    return argv ? runAsync([...H.wrapperArgv(run.pkg), ...argv], path.join(H.root, run.pkg.dir), { timeoutMs }) : Promise.resolve({ code: 0, out: '', ms: 0, noRunner: true });
  };
  const apply = async (m, fn) => {
    const f = abs(m.item.file);
    const orig = fs.readFileSync(f, 'utf8');
    const mutated = mutateText(orig, m.item.lang, m.f, m.marker);
    applied.set(f, { orig, mutated });
    try { journalWrite(); fs.writeFileSync(f, mutated); return await fn(); }
    finally {
      const r = putBack(f, { orig, mutated });
      if (r === 'foreign') throw new ForeignEdit(`mutate: ${m.item.file} was changed by something else during the run: NOT overwritten (it still holds mutant ${m.marker}); its original is in ${journal.file}`);
      if (r === 'restored-foreign') console.error(`mutate: ${m.item.file} was changed by something else during the run: restored (foreign edit kept)`);
      applied.delete(f); journalWrite();
    }
  };
  const tick = (m, what) => say(`[${m.n + 1}/${mutants.length}] ${m.label}: ${what} (timeout ${Math.round(timeoutMs / 1000)}s) ...`);
  const results = [];
  // ── prove-irrelevant ──
  if (a['prove-irrelevant']) {
    const globs = globsArg(H, a['prove-irrelevant']);
    const cand = new Map(); // pkg name -> [test rel]
    for (const pkg of Object.values(H.cfg.packages)) {
      const sel = new Set((runFor(pkg)?.tests) || []);
      const hitT = (H.all[pkg.name] || []).filter((x) => !H.isExcluded(pkg.name, x) && !sel.has(x) && (H.matchAny(x, globs) || H.matchAny(pkg.dir === '.' ? x : `${pkg.dir}/${x}`, globs)));
      if (hitT.length) cand.set(pkg.name, hitT);
    }
    const total = [...cand.values()].reduce((n, v) => n + v.length, 0);
    if (!total) throw new H.Usage('--prove-irrelevant: no excluded (not selected) test file matches those globs');
    say(`prove-irrelevant: ${total} excluded test file(s) run under ${mutants.length} mutant(s); a failure carrying the mutant marker proves a test relevant`);
    const relevant = new Map(), inconclusive = [];
    for (const m of mutants) {
      const pkg = m.item.pkg, tests = cand.get(pkg.name);
      if (!tests) { say(`[${m.n + 1}/${mutants.length}] ${m.label}: no candidate tests in package ${pkg.name}`); continue; }
      const run = async (set) => exec({ pkg, tests: set, related: [] });
      await apply(m, async () => {
        tick(m, `running ${tests.length} excluded test file(s)`);
        const first = await run(tests);
        const marked = (r) => r.code !== 0 && r.out.includes(m.marker);
        say(`[${m.n + 1}/${mutants.length}] ${m.label}: ${first.timedOut ? 'TIMEOUT' : marked(first) ? 'a candidate fails with the marker' : 'no candidate fails'} (${(first.ms / 1000).toFixed(1)}s)`);
        if (first.timedOut) { inconclusive.push(m.label); return; }
        if (!marked(first)) return;
        const bisect = async (set) => {
          if (set.length === 1) return set;
          const mid = Math.ceil(set.length / 2), out = [];
          for (const half of [set.slice(0, mid), set.slice(mid)]) { const r = await run(half); if (marked(r)) out.push(...await bisect(half)); }
          return out;
        };
        for (const x of await bisect(tests)) { const k = pkg.dir === '.' ? x : `${pkg.dir}/${x}`; relevant.set(k, [...(relevant.get(k) || []), m.label]); }
      });
    }
    const rel = [...relevant];
    if (a.json) say(JSON.stringify({ candidates: total, mutants: mutants.map((m) => m.label), relevant: Object.fromEntries(rel), inconclusive }, null, 2));
    else {
      for (const [tst, by] of rel) say(`RELEVANT   ${tst}   fails when ${by.join(', ')} throws: it must be selected (add a paths glob to its part)`);
      say(`irrelevant (no mutant failed them): ${total - rel.length} of ${total} excluded test file(s)${inconclusive.length ? `; inconclusive (timeout): ${inconclusive.join(', ')}` : ''}`);
    }
    return rel.length ? 1 : 0;
  }
  // ── default: would the selected tests catch each mutant ──
  const pkgs = [...new Set(mutants.map((m) => m.item.pkg))];
  if (!opts.skipBaseline) {
    for (const pkg of pkgs) {
      const run = runFor(pkg);
      if (!run) continue;
      say(`baseline ${pkg.name}: running the selected tests unmutated ...`);
      const r = await exec(run);
      say(`baseline ${pkg.name}: ${r.timedOut ? 'TIMEOUT' : r.code === 0 ? 'green' : 'RED'} (${(r.ms / 1000).toFixed(1)}s)`);
      if (r.code !== 0) { say(`mutate: the selected tests are red without any mutant: a mutant cannot be judged. Fix them first.\n${r.out.split('\n').slice(-15).join('\n')}`); return 1; }
    }
  }
  for (const m of mutants) {
    const run = runFor(m.item.pkg);
    let verdict, ms = 0;
    if (!run) verdict = 'survived';
    else {
      const r = await apply(m, () => { tick(m, 'running the selected tests'); return exec(run); });
      ms = r.ms;
      verdict = r.timedOut ? 'timeout' : r.code === 0 ? 'survived' : r.out.includes(m.marker) ? 'caught' : 'inconclusive';
    }
    results.push({ label: m.label, verdict, ms });
    say(`[${m.n + 1}/${mutants.length}] ${m.label}: ${verdict.toUpperCase()}${verdict === 'inconclusive' ? ' (the run failed but never mentioned the marker: invalid mutant, or the code swallows the error)' : ''}${!run ? ' (no test selected for its package)' : ''} (${(ms / 1000).toFixed(1)}s)`);
  }
  const n = (v) => results.filter((r) => r.verdict === v).length;
  if (a.json) say(JSON.stringify({ mutants: results, dropped: dropped.length }, null, 2));
  else {
    for (const r of results.filter((x) => x.verdict === 'survived')) say(`SURVIVED  ${r.label}: no selected test fails when this function throws: the change is not really tested`);
    say(`summary: caught ${n('caught')}, survived ${n('survived')}, timeout ${n('timeout')}, inconclusive ${n('inconclusive')}${dropped.length ? `, dropped ${dropped.length}` : ''}`);
  }
  return n('survived') ? 1 : 0;
}

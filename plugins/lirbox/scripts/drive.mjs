#!/usr/bin/env node
/*
 * drive.mjs — the loop. A process, not a prompt: every transition below is code, every fact it acts
 * on is an exit code or a file, and every step is checkpointed before the next one starts.
 *
 *   node drive.mjs --run <slug> --task <text|->   start: intake, then plan slice 1
 *   node drive.mjs --run <slug>                   resume from .orchestration/<slug>/drive.json
 *   node drive.mjs --run <slug> --continue        a human accepted the slice under review; plan the next
 *   node drive.mjs --run <slug> --status          print the checkpoint, change nothing
 *
 * Why this exists: conductor was linear and slow; loom + lirbox-herdr-orchestrator spawned lanes and
 * then relied on a model to remember to check on them, so work was started and never delivered.
 * Here nothing is remembered — it is read back from drive.json on every invocation.
 *
 *   intake ─▶ plan ─▶ build ─▶ check ─┬─▶ (judged?) verify ─┬─▶ review ─(--continue)─▶ plan …
 *                ▲      ▲              │ red                  │ red
 *                │      └── retry ─────┴──────── decide ◀──────┘
 *                ├───────── replan ─────────────── │
 *                └── rollback (reset to verified) ─┘ ─▶ escalate
 *
 * The only model in the control path is Jev, and only on red, choosing from a closed set that the
 * caps below have already pruned. "Done" is never judged: it is the criteria's exit codes, re-run
 * here, or a verifier's verdict filed against the exact SHA. NOT_MEASURED escalates; it never guesses.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const STOPS = ['review', 'done', 'escalated', 'rejected', 'inline'];
export const MAX_ATTEMPTS = 2;      // builds per slice before retry is no longer offered
export const MAX_ROLLBACKS = 1;     // per slice; loom's back-edge proved an uncapped one loops
export const MIN_CONFIDENCE = 0.5;  // below this a Jev choice is treated as NOT_MEASURED
export const DEFAULTS = { poll_ms: 20_000, stall_ms: 600_000, lane_timeout_ms: 7_200_000 };

// ── criteria ────────────────────────────────────────────────────────────────────────────────────
// Deterministic iff the expected value names an exit code. Anything else is JUDGED and goes to a
// verifier — never silently re-run and "passed" on exit 0 alone.
export function classify(criterion) {
  const m = /\bexit\s*[:=]?\s*(-?\d+)\b/i.exec(criterion.expected || '');
  return m ? { ...criterion, kind: 'run', exit: Number(m[1]) } : { ...criterion, kind: 'judged' };
}

// ── monitor ─────────────────────────────────────────────────────────────────────────────────────
// herdr status is truth for finished/blocked/dead. Hang is the one thing no status reports: a lane
// that says `working` forever. So progress is a fingerprint of what work leaves behind — HEAD, the
// dirty tree, the lane's progress file, its pane tail with timers stripped — and a fingerprint that
// has not moved for stall_ms is a hang. One restart, then a human.
export function watch(role, io, cfg, brief) {
  const t0 = io.now();
  let fp = null, movedAt = t0, restarts = 0;
  for (;;) {
    const st = io.status(role);
    if (st === 'idle' || st === 'done') return { outcome: 'finished' };
    if (st === 'blocked') return { outcome: 'blocked', detail: io.tail(role) };
    let why = null;
    if (st !== 'working') why = `lane status '${st}'`;
    else {
      const f = io.fingerprint(role);
      if (f !== fp) { fp = f; movedAt = io.now(); }
      else if (io.now() - movedAt >= cfg.stall_ms) why = `no progress for ${Math.round((io.now() - movedAt) / 1000)}s`;
    }
    if (why) {
      if (restarts >= 1) return { outcome: 'stalled', detail: why };
      restarts++;
      io.restart(role);
      io.brief(role, `${brief}\n\nYou were restarted (${why}). Read \`git log\` and your progress file to see what is already done; continue from there.`);
      fp = null; movedAt = io.now();
    }
    if (io.now() - t0 >= cfg.lane_timeout_ms) return { outcome: 'timeout', detail: `over ${cfg.lane_timeout_ms}ms` };
    io.monitor(role, { status: st, moved_at: movedAt, restarts });
    io.sleep(cfg.poll_ms);
  }
}

// ── the step function: state in, state out. drive() persists between every call. ───────────────
const briefs = {
  plan: (s, run) => [
    `Plan slice ${s.slice} of run '${run}'. Task:\n\n${s.task}`,
    s.last ? `Previous result (observed, not predicted):\n${JSON.stringify(s.last, null, 2)}` : 'This is the first slice.',
    `Record it by RUNNING: node ${join(HERE, 'board.mjs')} --run ${run} --set ${s.slice} --status planned --delivers "<one line>" --criterion "<cmd> :: exit <N>" ...`,
    'A criterion the driver can re-run MUST name its exit code (`:: exit 0`). Anything else is judged by a verifier.',
    `If the task is fully delivered and no slice remains, instead write the reason to .orchestration/${run}/COMPLETE.`,
  ].join('\n\n'),
  build: (s, slice) => [
    `Implement slice ${s.slice}: ${slice.delivers}`,
    `Criteria (the driver re-runs these itself after you stop):\n${slice.criteria.map((c) => `- \`${c.command}\` :: ${c.expected}`).join('\n')}`,
    s.last?.red ? `Previous attempt was red:\n${JSON.stringify(s.last.red, null, 2)}` : '',
    'Commit your work. Rewrite your progress file after each item (todo|doing|done|blocked).',
    'Red means stop and report observed values. Do not weaken an assertion to get green.',
  ].filter(Boolean).join('\n\n'),
  verify: (s, slice, run) => [
    `Verify slice ${s.slice} at ${s.candidate_sha}. You did not write it. Judged criteria:`,
    slice.criteria.filter((c) => c.kind === 'judged').map((c) => `- ${c.command} :: ${c.expected}`).join('\n'),
    `Write .orchestration/${run}/verdicts/${s.slice}.json as {"sha": "${s.candidate_sha}", "pass": true|false, "observed": "..."}`,
  ].join('\n\n'),
};

function laneFailed(s, w) { return { ...s, phase: 'escalated', reason: `${w.outcome}: ${w.detail ?? ''}`.trim() }; }

export function step(s, io, cfg, run) {
  switch (s.phase) {
    case 'intake': {
      const r = io.intake(s.task);
      if (r.route === 'reject') return { ...s, phase: 'rejected', reason: r.reason };
      if (r.route === 'inline') return { ...s, phase: 'inline', reason: r.reason };
      return { ...s, phase: 'plan', slice: 1, attempt: 0, rollbacks: 0, verified_sha: null };
    }
    case 'plan': {
      io.clearSlice(s.slice);
      const text = briefs.plan(s, run);
      io.brief('planner', text, s.verified_sha);
      const w = watch('planner', io, cfg, text);
      if (w.outcome !== 'finished') return laneFailed(s, w);
      if (io.complete()) return { ...s, phase: 'done', reason: io.complete() };
      const slice = io.slice(s.slice);
      if (!slice || !slice.criteria?.length) return { ...s, phase: 'escalated', reason: `planner filed no slice ${s.slice} with criteria` };
      return { ...s, phase: 'build', attempt: 1 };
    }
    case 'build': {
      const slice = io.slice(s.slice);
      const text = briefs.build(s, slice);
      // The first build pins the baseline: the tree the builder starts from is the last verified one.
      const verified = s.verified_sha ?? io.head('builder');
      io.board(s.slice, { status: 'in_progress', by: 'builder' });
      io.brief('builder', text);
      const w = watch('builder', io, cfg, text);
      if (w.outcome !== 'finished') return laneFailed({ ...s, verified_sha: verified }, w);
      return { ...s, phase: 'check', verified_sha: verified, candidate_sha: io.head('builder') };
    }
    case 'check': {
      if (s.candidate_sha === s.verified_sha) return { ...s, phase: 'decide', red: [{ command: 'git rev-parse HEAD', expected: 'a new commit', observed: 'HEAD did not move' }] };
      const criteria = io.slice(s.slice).criteria.map(classify);
      const red = [];
      for (const c of criteria.filter((c) => c.kind === 'run')) {
        const got = io.run(c.command);
        if (got !== c.exit) red.push({ command: c.command, expected: `exit ${c.exit}`, observed: `exit ${got}` });
      }
      if (red.length) return { ...s, phase: 'decide', red };
      return { ...s, phase: criteria.some((c) => c.kind === 'judged') ? 'verify' : 'accept', verifier: 'drive' };
    }
    case 'verify': {
      const slice = { ...io.slice(s.slice), criteria: io.slice(s.slice).criteria.map(classify) };
      const text = briefs.verify(s, slice, run);
      io.brief('verifier', text, s.candidate_sha);
      const w = watch('verifier', io, cfg, text);
      if (w.outcome !== 'finished') return laneFailed(s, w);
      const v = io.verdict(s.slice);
      if (!v || v.sha !== s.candidate_sha) return { ...s, phase: 'escalated', reason: `no verdict for ${s.candidate_sha}` };
      if (v.pass !== true) return { ...s, phase: 'decide', red: [{ command: 'verifier', expected: 'pass', observed: v.observed ?? 'fail' }] };
      return { ...s, phase: 'accept', verifier: 'verifier' };
    }
    case 'accept': {
      io.board(s.slice, { status: 'delivered', verified_by: s.verifier });
      return { ...s, phase: 'review', verified_sha: s.candidate_sha, red: null, last: { slice: s.slice, sha: s.candidate_sha, result: 'delivered' } };
    }
    case 'decide': {
      const options = { escalate: 'stop and hand to a human' };
      if (s.attempt < MAX_ATTEMPTS) options.retry = 'same plan, build again with the red values';
      options.replan = 'the slice was wrong; plan it again from what was observed';
      if (s.rollbacks < MAX_ROLLBACKS) options.rollback = 'discard this slice\'s commits back to the last verified SHA, then replan';
      const a = io.jev({ slice: io.slice(s.slice), attempt: s.attempt, rollbacks: s.rollbacks, red: s.red }, options);
      const choice = a && a.choice in options && (a.confidence ?? 0) >= MIN_CONFIDENCE ? a.choice : 'escalate';
      const last = { slice: s.slice, red: s.red, decided: choice };
      if (choice === 'retry') return { ...s, phase: 'build', attempt: s.attempt + 1, last };
      if (choice === 'replan') return { ...s, phase: 'plan', last };
      if (choice === 'rollback') { io.reset('builder', s.verified_sha); return { ...s, phase: 'plan', rollbacks: s.rollbacks + 1, last }; }
      return { ...s, phase: 'escalated', reason: a ? `jev: ${a.choice ?? 'NOT_MEASURED'}` : 'jev: NOT_MEASURED', last };
    }
    default: throw new Error(`unknown phase ${s.phase}`);
  }
}

export function drive(s, io, cfg, run) {
  while (!STOPS.includes(s.phase)) {
    const next = step(s, io, cfg, run);
    next.history = [...(s.history || []), { at: io.now(), from: s.phase, to: next.phase }];
    io.save(next);
    s = next;
  }
  return s;
}

// ── the real io: herdr lanes via orch-lane.sh, Jev via jev.mjs, board via board.mjs ─────────────
function realIO(root, run) {
  const store = join(root, '.orchestration', run);
  const lane = (role) => `${run}-${role}`;
  const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', cwd: root, ...opts });
  const herdr = (...a) => { const r = sh('herdr', a, { env: { ...process.env, HERDR_ENV: '1' } }); return r.status === 0 ? r.stdout : ''; };
  const orch = (...a) => { const r = sh(join(HERE, 'orch-lane.sh'), a); if (r.status !== 0) throw new Error(`orch-lane ${a[0]}: ${r.stderr.trim()}`); return r.stdout; };
  const record = (role) => { const f = join(store, 'dispatch', `${lane(role)}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
  const wt = (role) => record(role)?.worktree || root;
  const readJSON = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
  const ensure = (role) => {
    if (record(role) && herdr('agent', 'get', lane(role))) return;
    orch('start', lane(role), '--profile', role, '--run', run, ...(role === 'builder' ? [] : ['--role', role]));
  };
  const git = (role, ...a) => sh('git', ['-C', wt(role), ...a]).stdout.trim();
  const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
  return {
    now: () => Date.now(),
    sleep: (ms) => Atomics.wait(sleepBuf, 0, 0, ms),
    save: (s) => { mkdirSync(store, { recursive: true }); writeFileSync(join(store, 'drive.json'), JSON.stringify(s, null, 2) + '\n'); },
    intake: (task) => {
      sh(process.execPath, [join(HERE, 'intake.mjs'), '--task', '-', '--run', run], { input: task });
      return readJSON(join(store, 'route.json')) || { route: 'inline', reason: 'intake wrote no route.json' };
    },
    head: (role) => { ensure(role); return git(role, 'rev-parse', 'HEAD'); },
    brief: (role, text, sha) => {
      ensure(role);
      if (sha && role !== 'builder') git(role, 'checkout', '--detach', sha);   // read-only lanes see the verified tree
      const f = join(store, 'briefs', `${lane(role)}.md`);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, text + `\n\nProgress file: ${join(store, 'progress', `${lane(role)}.md`)}\n`);
      orch('brief', lane(role), f);
    },
    status: (role) => {
      const out = herdr('agent', 'get', lane(role));
      if (!out) return 'missing';
      const j = JSON.parse(out);
      return j.result?.agent?.agent_status ?? j.result?.agent_status ?? 'unknown';
    },
    tail: (role) => herdr('agent', 'read', lane(role), '--lines', '20').trim(),
    fingerprint: (role) => {
      const pf = join(store, 'progress', `${lane(role)}.md`);
      // ponytail: digits and non-ASCII (spinners, timers) stripped so a ticking clock is not progress;
      // a lane that only thinks, never writes, for stall_ms reads as hung. Raise lanes.stall_ms if so.
      const pane = herdr('agent', 'read', lane(role), '--lines', '40').replace(/[0-9]|[^\x00-\x7f]/g, '');
      return createHash('sha1').update([git(role, 'rev-parse', 'HEAD'), git(role, 'status', '--porcelain'),
        existsSync(pf) ? readFileSync(pf, 'utf8') : '', pane].join('\0')).digest('hex');
    },
    restart: (role) => orch('restart', lane(role), '--run', run, '--force'),
    monitor: (role, m) => { const d = join(store, 'monitor'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, `${lane(role)}.json`), JSON.stringify({ ...m, at: Date.now() }) + '\n'); },
    run: (cmd) => sh('sh', ['-c', cmd], { cwd: wt('builder'), stdio: 'ignore' }).status ?? -1,
    reset: (role, sha) => git(role, 'reset', '--hard', sha),
    // A replan must be a NEW filing. Left in place, the old slice satisfies "planner filed a slice"
    // even when the planner filed nothing — so it is moved aside, never deleted.
    clearSlice: (id) => {
      const f = join(store, 'slices', `${id}.json`);
      if (!existsSync(f)) return;
      mkdirSync(join(store, 'replaced'), { recursive: true });
      renameSync(f, join(store, 'replaced', `${id}-${Date.now()}.json`));
    },
    slice: (id) => readJSON(join(store, 'slices', `${id}.json`)),
    complete: () => (existsSync(join(store, 'COMPLETE')) ? readFileSync(join(store, 'COMPLETE'), 'utf8').trim() || 'complete' : null),
    verdict: (id) => readJSON(join(store, 'verdicts', `${id}.json`)),
    board: (id, o) => {
      const a = [join(HERE, 'board.mjs'), '--run', run, '--set', String(id), '--status', o.status, '--at', new Date().toISOString()];
      if (o.by) a.push('--by', o.by);
      if (o.verified_by) a.push('--verified-by', o.verified_by);
      const r = sh(process.execPath, a);
      if (r.status !== 0) throw new Error(`board: ${r.stderr.trim()}`);
    },
    jev: (state, options) => {
      const d = join(store, 'jev'); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'state.json'), JSON.stringify(state));
      writeFileSync(join(d, 'q.json'), JSON.stringify({ next: { type: 'choice', question: 'A slice went red. Given the observed values, which next step?', criteria: options } }));
      sh(process.execPath, [join(HERE, 'jev.mjs'), '--state', join(d, 'state.json'), '--questions', join(d, 'q.json'), '--out', join(d, 'answer.json')]);
      const a = readJSON(join(d, 'answer.json'))?.next;
      return a && a.choice && a.choice !== 'NOT_MEASURED' ? a : null;
    },
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : undefined; };
  const run = val('--run');
  if (!run || !/^[A-Za-z0-9._-]+$/.test(run) || /^\.+$/.test(run)) { console.error('drive: --run <slug> required ([A-Za-z0-9._-]+)'); process.exit(2); }
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim() || process.cwd();
  const ckpt = join(root, '.orchestration', run, 'drive.json');
  let s = existsSync(ckpt) ? JSON.parse(readFileSync(ckpt, 'utf8')) : null;

  if (argv.includes('--status')) { console.log(s ? JSON.stringify(s, null, 2) : `no run '${run}'`); process.exit(0); }
  if (!s) {
    let task = val('--task');
    if (task === '-') task = readFileSync(0, 'utf8');
    if (!task?.trim()) { console.error(`drive: no checkpoint for '${run}' — start it with --task`); process.exit(2); }
    s = { phase: 'intake', task: task.trim() };
  }
  if (argv.includes('--continue')) {
    if (s.phase !== 'review') { console.error(`drive: --continue only moves a run out of 'review'; '${run}' is in '${s.phase}'`); process.exit(2); }
    s = { ...s, phase: 'plan', slice: s.slice + 1, attempt: 0, rollbacks: 0 };
  } else if (s.phase === 'escalated' && argv.includes('--retry')) {
    s = { ...s, phase: 'plan' };   // a human resolved the escalation; replan from what was observed
  }

  let cfg = { ...DEFAULTS };
  // Same key orch-lane.sh uses: sha1 of the absolute git common dir, first 12 hex.
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).stdout.trim() || process.cwd();
  const slug = createHash('sha1').update(common).digest('hex').slice(0, 12);
  const cfgFile = join(process.env.HOME, '.claude', 'lirbox-orchestrator', `${slug}.json`);
  try { const l = JSON.parse(readFileSync(cfgFile, 'utf8')).lanes || {}; for (const k of Object.keys(DEFAULTS)) if (typeof l[k] === 'number') cfg[k] = l[k]; } catch {}

  const end = drive(s, realIO(root, run), cfg, run);
  console.log(`${run}: ${end.phase}${end.reason ? ` — ${end.reason}` : ''}`);
  if (end.phase === 'review') console.log(`slice ${end.slice} delivered at ${end.verified_sha}. Review it, then: node ${fileURLToPath(import.meta.url)} --run ${run} --continue`);
  process.exit(end.phase === 'escalated' ? 3 : 0);
}

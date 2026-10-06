// Async command runner with a bounded timeout and process-group kill; shared by changecov and mutate.
import { spawn } from 'node:child_process';

const active = new Set();
/** Kill every child still running (signal handlers call this before restoring files). */
export function killActive(sig = 'SIGKILL') {
  for (const c of active) { try { process.kill(-c.pid, sig); } catch { try { c.kill(sig); } catch { /* gone */ } } }
}

const CAP = 8 << 20;

/**
 * Run argv in cwd. Output is captured (tail kept above 8 MB); `stream` also echoes it live.
 * -> {code, signal, timedOut, out, ms, error?}. A timeout kills the whole process group (wrappers spawn grandchildren).
 */
export function runAsync(argv, cwd, { timeoutMs = 900_000, stream = false, env } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let out = '', timedOut = false, done = false;
    let child;
    try { child = spawn(argv[0], argv.slice(1), { cwd, env: env || process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { resolve({ code: null, signal: null, timedOut: false, out: '', ms: 0, error: String(e) }); return; }
    active.add(child);
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); active.delete(child); resolve({ ...r, timedOut, out, ms: Date.now() - t0 }); };
    const onData = (d) => { const s = d.toString(); out += s; if (out.length > CAP) out = out.slice(-(CAP >> 1)); };
    child.stdout.on('data', (d) => { onData(d); if (stream) process.stdout.write(d); });
    child.stderr.on('data', (d) => { onData(d); if (stream) process.stderr.write(d); });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } }, timeoutMs);
    child.on('error', (e) => finish({ code: null, signal: null, error: String(e) }));
    child.on('close', (code, signal) => finish({ code, signal }));
  });
}

/** Last informative line of a failed run's output. */
export function lastError(out, fallback = 'no output') {
  const ls = String(out || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return (ls.reverse().find((l) => /error|cannot|not found|no module|unrecognized|failed|missing/i.test(l)) || ls[0] || fallback).slice(0, 300);
}

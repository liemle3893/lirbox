#!/usr/bin/env node
/*
 * Freeze a definition of done into hash-locked check FILES.
 *
 *   node dod-freeze.mjs --dod <dod.json> --checks-dir <dir>
 *
 * Why files rather than a `check` string in JSON:
 *   - they ride the PR, so a reviewer can read the check
 *   - the human can re-run them after merge
 *   - multi-line scripts survive without shell/JSON quoting mangling
 *   - the sha256 lock makes a weakened check DETECTED rather than rewarded —
 *     today, editing the test a check runs is the cheapest route to a green gate
 *
 * Real sha256 here (not the conductor's FNV-1a): this runs with full Node, and
 * this lock is guarding against tampering, not merely drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// A criterion id names a FILE that is written executable, and a checkFile names
// a file that is read back. Both arrive inside a dod.json a worker wrote, so
// neither is a name this script chose. `../` in an id writes a 0755 file
// wherever it points. See docs/security/untrusted-input.md.
const ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function inside(root, p) {
  const abs = path.resolve(root, p);
  return abs === root || abs.startsWith(root + path.sep);
}

export function sha256File(p) {
  return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// Returns one row per checkable criterion: { id, ok, reason }.
// `root` is the directory the criteria's relative checkFile paths resolve against.
export function verifyChecks(dod, root) {
  const out = [];
  for (const c of dod.criteria || []) {
    if (c.tier !== 'checkable') continue;
    if (typeof c.checkFile !== 'string' || !inside(path.resolve(root), c.checkFile)) {
      out.push({ id: c.id, ok: false, reason: `checkFile is not inside the DoD's own directory: ${JSON.stringify(c.checkFile)}` });
      continue;
    }
    const p = path.resolve(root, c.checkFile);
    if (!fs.existsSync(p)) { out.push({ id: c.id, ok: false, reason: 'check file missing: ' + c.checkFile }); continue; }
    const actual = sha256File(p);
    if (actual !== c.checkSha) {
      out.push({ id: c.id, ok: false, reason: `check file modified — sha mismatch (frozen ${c.checkSha}, found ${actual})` });
      continue;
    }
    out.push({ id: c.id, ok: true, reason: 'sha matches frozen value' });
  }
  return out;
}

function main() {
  const argv = process.argv;
  const arg = (n, d) => {
    const i = argv.indexOf('--' + n);
    if (i < 0) return d;
    const v = argv[i + 1];
    return (v === undefined || v.startsWith('--')) ? true : v;
  };
  const dodPath = arg('dod', '');
  const checksDir = arg('checks-dir', '');
  if (!dodPath || dodPath === true) { console.error('ERROR: --dod is required'); process.exit(1); }
  if (!checksDir || checksDir === true) { console.error('ERROR: --checks-dir is required'); process.exit(1); }

  const dod = JSON.parse(fs.readFileSync(dodPath, 'utf8'));
  fs.mkdirSync(checksDir, { recursive: true });
  const root = path.dirname(path.resolve(dodPath));

  for (const c of dod.criteria || []) {
    if (c.tier !== 'checkable') continue;
    if (typeof c.script !== 'string' || !c.script.trim()) {
      console.error(`ERROR: checkable criterion '${c.id}' has no "script" to freeze`);
      process.exit(1);
    }
    if (typeof c.id !== 'string' || !ID_OK.test(c.id)) {
      console.error(`ERROR: criterion id ${JSON.stringify(c.id)} is not usable — it becomes the filename of an`);
      console.error('       executable check. Letters, digits and . _ - only, 128 chars max.');
      process.exit(1);
    }
    const file = path.join(checksDir, `${c.id}.sh`);
    if (!inside(path.resolve(checksDir), file)) {
      console.error(`ERROR: criterion '${c.id}' would write outside --checks-dir`);
      process.exit(1);
    }
    fs.writeFileSync(file, c.script.endsWith('\n') ? c.script : c.script + '\n', { mode: 0o755 });
    fs.chmodSync(file, 0o755);
    c.checkFile = path.relative(root, file);
    c.checkSha = sha256File(file);
    // A criterion already met at baseline cannot discriminate this run's work.
    // "red" is the default; "green-ok" is a deliberate, human-confirmed waiver
    // for genuine regression guards.
    c.baseline = c.baseline === 'green-ok' ? 'green-ok' : 'red';
    delete c.script;
  }

  fs.writeFileSync(dodPath, JSON.stringify(dod, null, 2) + '\n');
  const n = (dod.criteria || []).filter((c) => c.tier === 'checkable').length;
  process.stdout.write(`Froze ${n} check file(s) into ${checksDir}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('dod-freeze.mjs')) main();

#!/usr/bin/env node
// test-scope: path-aware test selection. Node >= 20, no dependencies.
//   detect | select | run | coverage | replay | misses | rules      (see SKILL.md <scripts>)
// Exit: 0 ok, 1 test/check failed or problems found, 2 internal error, 3 uncovered changed files, 64 usage.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

class Usage extends Error {}

// ───────────────────────── globs ─────────────────────────
export function expandBraces(glob) {
  const open = glob.indexOf('{');
  if (open < 0) return [glob];
  let depth = 0, close = -1;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === '{') depth++;
    else if (glob[i] === '}' && --depth === 0) { close = i; break; }
  }
  if (close < 0) return [glob];
  const alts = [];
  let cur = '';
  depth = 0;
  for (const c of glob.slice(open + 1, close)) {
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth === 0) { alts.push(cur); cur = ''; } else cur += c;
  }
  alts.push(cur);
  return alts.flatMap((a) => expandBraces(glob.slice(0, open) + a + glob.slice(close + 1)));
}

function oneGlob(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^$()|[\]\\{}]/g, '\\$&');
  }
  return re;
}

const globCache = new Map();
export function globToRegExp(glob) {
  let re = globCache.get(glob);
  if (!re) {
    re = new RegExp(`^(?:${expandBraces(glob).map(oneGlob).join('|')})$`);
    globCache.set(glob, re);
  }
  return re;
}
export const matchGlob = (file, glob) => globToRegExp(glob).test(file);
export const matchAny = (file, globs) => (globs || []).some((g) => matchGlob(file, g));
/** Positive globs plus `!glob` exclusions that win over any positive. */
export function matchesPaths(file, paths) {
  const neg = paths.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
  if (neg.length && matchAny(file, neg)) return false;
  return matchAny(file, paths.filter((p) => !p.startsWith('!')));
}

// ───────────────────────── git ─────────────────────────
function git(root, args, opts = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
const lines = (s) => s.split('\n').filter(Boolean);
const gitOk = (root, args) => { try { return git(root, args); } catch { return null; } };

function repoRoot(cwd) {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw new Usage('not inside a git repository'); }
}
const repoFiles = (root) => [...new Set(lines(git(root, ['ls-files', '-co', '--exclude-standard'])))]
  .filter((f) => fs.existsSync(path.join(root, f)));

function resolveBase(root, cfg, base) {
  if (base) return base;
  for (const ref of [cfg.base && `origin/${cfg.base}`, cfg.base, 'origin/main', 'main', 'origin/master', 'master'].filter(Boolean)) {
    const mb = gitOk(root, ['merge-base', 'HEAD', ref]);
    if (mb) return mb.trim();
  }
  throw new Usage('no base given and no origin/main, main or master to take a merge-base with');
}

function changedFiles(root, base, to) {
  const out = new Set(lines(git(root, to ? ['diff', '--name-only', base, to] : ['diff', '--name-only', base])));
  const deleted = new Set(lines(git(root, to ? ['diff', '--name-only', '--diff-filter=D', base, to] : ['diff', '--name-only', '--diff-filter=D', base])));
  if (!to) for (const f of lines(git(root, ['ls-files', '--others', '--exclude-standard']))) out.add(f);
  // a path in the working tree that no longer exists counts as deleted too
  if (!to) for (const f of out) if (!fs.existsSync(path.join(root, f))) deleted.add(f);
  return { files: [...out].sort(), deleted };
}

const MANIFEST = /(^|\/)(package\.json|go\.mod|pyproject\.toml|requirements[^/]*\.txt|Pipfile|Cargo\.toml)$/;
function depsFingerprint(file, text) {
  if (text === null) return 'null';
  const b = path.basename(file);
  if (b === 'package.json') {
    try {
      const j = JSON.parse(text);
      return JSON.stringify([j.dependencies, j.devDependencies, j.peerDependencies, j.optionalDependencies].map((x) => x ?? {}));
    } catch { return text; }
  }
  if (b === 'go.mod') return text.split('\n').map((l) => l.trim()).filter((l) => /^(require\s+)?[\w./~-]+\s+v[\w.+-]+/.test(l)).join('\n');
  return text.trim();
}
/** Manifests among `files` whose dependency fields differ between base and to (or the working tree). */
function depsChanged(root, files, base, to) {
  const show = (ref, f) => gitOk(root, ['show', `${ref}:${f}`]);
  return files.filter((f) => MANIFEST.test(f)).filter((f) => {
    const now = to ? show(to, f) : fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf8') : null;
    return depsFingerprint(f, show(base, f)) !== depsFingerprint(f, now);
  });
}

// ───────────────────────── config ─────────────────────────
const DEFAULT_TEST_GLOBS = {
  vitest: ['**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}', '**/__tests__/**/*.{js,jsx,ts,tsx}'],
  jest: ['**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}', '**/__tests__/**/*.{js,jsx,ts,tsx}'],
  pytest: ['**/test_*.py', '**/*_test.py'],
  go: ['**/*_test.go'],
};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Usage(`${file}: ${e.code === 'ENOENT' ? 'not found' : 'not valid JSON: ' + e.message}`); }
}

function loadRaw(file, seen = new Set()) {
  const abs = path.resolve(file);
  if (seen.has(abs)) throw new Usage(`${file}: "extends" cycle`);
  seen.add(abs);
  const raw = readJson(abs);
  if (!raw.extends) return raw;
  const base = loadRaw(path.resolve(path.dirname(abs), raw.extends), seen);
  const merged = { ...base, ...raw };
  for (const k of ['packages', 'parts']) if (base[k] || raw[k]) merged[k] = { ...(base[k] || {}), ...(raw[k] || {}) };
  delete merged.extends;
  return merged;
}

function guessRunner(dir, root) {
  const abs = path.join(root, dir);
  const has = (f) => fs.existsSync(path.join(abs, f));
  if (has('package.json')) {
    const j = readJson(path.join(abs, 'package.json'));
    const deps = { ...j.dependencies, ...j.devDependencies };
    if (deps.vitest) return 'vitest';
    if (deps.jest || deps['ts-jest'] || j.jest) return 'jest';
  }
  if (has('pyproject.toml') || has('pytest.ini') || has('setup.cfg') || has('conftest.py') || has('tox.ini')) return 'pytest';
  if (has('go.mod')) return 'go';
  return 'none';
}

export function loadConfig(root, configArg) {
  let file = configArg ? path.resolve(configArg) : path.join(root, '.test-scope/parts.json');
  if (configArg && !fs.existsSync(file)) file = path.join(root, configArg);
  if (!fs.existsSync(file)) {
    throw new Usage(`no config at ${path.relative(root, file) || file}: create .test-scope/parts.json (schema: references/parts-schema.md) or pass --config <path>`);
  }
  const raw = loadRaw(file);
  const warnings = [];
  const pkgs = {};
  const rawPkgs = raw.packages && Object.keys(raw.packages).length ? raw.packages : { root: { dir: '.' } };
  for (const [name, p] of Object.entries(rawPkgs)) {
    const dir = (p.dir || '.').replace(/^\.\//, '').replace(/\/$/, '') || '.';
    const runner = p.runner || guessRunner(dir, root);
    pkgs[name] = {
      name, dir, runner,
      testGlobs: p.testGlobs || DEFAULT_TEST_GLOBS[runner] || [],
      exclude: p.exclude || [],
      cmd: p.cmd, wrapper: p.wrapper, relatedCmd: p.relatedCmd,
    };
  }
  const names = Object.keys(pkgs);
  const parts = {};
  for (const [pname, p] of Object.entries(raw.parts || {})) {
    const tests = {};
    const add = (pkg, globs) => { if (Array.isArray(globs)) tests[pkg] = [...(tests[pkg] || []), ...globs]; };
    if (Array.isArray(p.tests)) { if (names.length === 1) add(names[0], p.tests); else warnings.push(`part ${pname}: "tests" is a list but there are ${names.length} packages; use {package: [globs]}`); }
    else for (const [k, v] of Object.entries(p.tests || {})) add(k, v);
    for (const k of Object.keys(p)) if (!['description', 'paths', 'tests', 'checks'].includes(k) && names.includes(k)) add(k, p[k]); // msn shape: top-level "<package>": [globs]
    for (const k of Object.keys(tests)) if (!pkgs[k]) { warnings.push(`part ${pname}: tests for unknown package "${k}" ignored`); delete tests[k]; }
    parts[pname] = { description: p.description || '', paths: p.paths || [], tests, checks: p.checks || [] };
  }
  const graphOnly = {};
  for (const [k, v] of Object.entries(raw.graphOnly || {})) if (pkgs[k]) graphOnly[k] = v;
  for (const p of Object.values(pkgs)) {
    if (!DEFAULT_TEST_GLOBS[p.runner] && !['custom', 'none'].includes(p.runner)) warnings.push(`package ${p.name}: unknown runner "${p.runner}": parts only, no import graph`);
  }
  return { file, raw, base: raw.base, noTests: raw.noTests || [], runAll: raw.runAll || [], graphOnly, packages: pkgs, parts, warnings };
}

// ───────────────────────── inventory ─────────────────────────
function pkgOf(cfg, file) {
  let best = null;
  for (const p of Object.values(cfg.packages)) {
    const inside = p.dir === '.' ? true : file.startsWith(p.dir + '/');
    if (inside && (!best || p.dir.length > best.dir.length)) best = p;
  }
  if (!best) return null;
  return { pkg: best, rel: best.dir === '.' ? file : file.slice(best.dir.length + 1) };
}

/** Every test file per package (relative to the package dir), excluded ones included. */
function listAllTests(cfg, files) {
  const all = Object.fromEntries(Object.keys(cfg.packages).map((n) => [n, []]));
  for (const f of files) {
    if (/(^|\/)node_modules\//.test(f)) continue;
    const p = pkgOf(cfg, f);
    if (p && matchAny(p.rel, p.pkg.testGlobs)) all[p.pkg.name].push(p.rel);
  }
  // a nested package takes its files from the outer one
  for (const n of Object.keys(all)) all[n] = [...new Set(all[n])].sort();
  return all;
}

const isExcluded = (cfg, pkg, rel) => matchAny(rel, cfg.packages[pkg].exclude);
function partTests(cfg, part, pkg, all) {
  return all[pkg].filter((f) => matchAny(f, part.tests[pkg] || []) && !isExcluded(cfg, pkg, f));
}

// ───────────────────────── selection ─────────────────────────
function emptySel(cfg) {
  const per = (v) => Object.fromEntries(Object.keys(cfg.packages).map((n) => [n, v()]));
  return { parts: [], entries: [], related: per(() => []), srcHits: {}, graph: {}, checks: [], uncovered: [], noTests: [], runAll: false, warnings: [] };
}
const short = (files) => (files.length <= 2 ? files.join(', ') : `${files.slice(0, 2).join(', ')} +${files.length - 2}`);
const addEntry = (sel, e) => { if (!sel.entries.some((x) => x.pkg === e.pkg && x.file === e.file)) sel.entries.push(e); };

function addPart(cfg, sel, name, all, reason) {
  const part = cfg.parts[name];
  if (!part) throw new Usage(`unknown part: ${name}`);
  if (!sel.parts.includes(name)) sel.parts.push(name);
  for (const pkg of Object.keys(cfg.packages)) for (const file of partTests(cfg, part, pkg, all)) addEntry(sel, { part: name, pkg, file, reason });
  for (const c of part.checks) if (!sel.checks.includes(c)) sel.checks.push(c);
}

export function selectParts(cfg, names, all) {
  const sel = emptySel(cfg);
  for (const n of names) addPart(cfg, sel, n, all, `--part ${n}`);
  return sel;
}

export function selectChanged(cfg, { files, deleted = new Set(), depsChanged: dc = [], all }) {
  const sel = emptySel(cfg);
  const depsSet = new Set(dc);
  const testSets = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, new Set(v)]));
  const forced = [];
  const reasons = new Map();
  const direct = [];
  for (const file of files) {
    const manifest = MANIFEST.test(file);
    if (manifest) { if (depsSet.has(file)) { forced.push(file); continue; } }
    else if (matchAny(file, cfg.runAll)) { forced.push(file); continue; }
    const p = pkgOf(cfg, file);
    let isTest = false;
    if (p && !deleted.has(file) && testSets[p.pkg.name].has(p.rel)) {
      if (isExcluded(cfg, p.pkg.name, p.rel)) { sel.noTests.push(file); continue; }
      const owner = Object.entries(cfg.parts).find(([, part]) => matchAny(p.rel, part.tests[p.pkg.name] || []))?.[0] ?? '(none)';
      direct.push({ pkg: p.pkg.name, file: p.rel, part: owner });
      isTest = true;
    }
    const hit = Object.entries(cfg.parts).filter(([, part]) => matchesPaths(file, part.paths)).map(([n]) => n);
    for (const n of hit) reasons.set(n, [...(reasons.get(n) || []), file]);
    if (isTest) continue;
    if (manifest) { if (!hit.length) sel.noTests.push(file); continue; } // manifest edit that changed no dependency
    if (!hit.length && matchAny(file, cfg.noTests)) { sel.noTests.push(file); continue; }
    sel.srcHits[file] = hit;
    // every changed source goes to the import graph; parts are added on top of it, never instead
    if (p && p.pkg.runner !== 'none' && !deleted.has(file)) sel.related[p.pkg.name].push(p.rel);
    else if (!hit.length) sel.uncovered.push(file + (deleted.has(file) ? ' (deleted)' : ''));
  }
  if (forced.length) {
    sel.runAll = true;
    for (const n of Object.keys(sel.related)) sel.related[n] = [];
    for (const n of Object.keys(cfg.parts)) addPart(cfg, sel, n, all, `run-all: ${short(forced)}`);
    for (const [pkg, tests] of Object.entries(all)) for (const file of tests) if (!isExcluded(cfg, pkg, file)) addEntry(sel, { part: '(run-all)', pkg, file, reason: `run-all: ${short(forced)}` });
    sel.uncovered = [];
    sel.parts.sort();
    return sel;
  }
  for (const [n, fs_] of reasons) addPart(cfg, sel, n, all, `paths: ${short(fs_)}`);
  for (const d of direct) addEntry(sel, { part: d.part, pkg: d.pkg, file: d.file, reason: 'changed test file' });
  sel.parts.sort();
  return sel;
}

// ───────────────────────── adapters ─────────────────────────
function shellWords(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function pmPrefix(root, pkg) {
  let d = path.join(root, pkg.dir);
  for (;;) {
    if (fs.existsSync(path.join(d, 'pnpm-lock.yaml'))) return ['pnpm', 'exec'];
    if (fs.existsSync(path.join(d, 'yarn.lock'))) return ['yarn'];
    if (d === root || path.dirname(d) === d) break;
    d = path.dirname(d);
  }
  return ['npx', '--no-install'];
}

/** Run a resolver command through the package's wrapper (lock / env guard), exactly like `run` does. */
function wrapped(root, pkg, argv, cwd) {
  const full = [...wrapperArgv(root, pkg), ...argv];
  return runCapture(full[0], full.slice(1), cwd);
}

/** The most telling line of a failed command's stderr: the first `Error:` line, else the first non-stack line. */
export function errorSummary(stderr, fallback = 'command failed') {
  const ls = String(stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const pick = ls.find((l) => /(^|\s)\w*Error\b.*:/.test(l) && !/^at /.test(l)) || ls.find((l) => !/^(at |Node\.js v|\^+$|\d+\s*\|)/.test(l)) || fallback;
  return pick.slice(0, 300);
}

function runCapture(cmd, args, cwd, input) {
  if (process.env.TEST_SCOPE_TRACE) fs.appendFileSync(process.env.TEST_SCOPE_TRACE, [cmd, ...args].join(' ') + '\n');
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', input, maxBuffer: 256 << 20 });
  if (r.error || r.status !== 0) return { ok: false, out: r.stdout || '', err: errorSummary((r.stderr || '') + (r.error ? '\n' + String(r.error) : ''), r.error ? String(r.error) : `exit ${r.status}`) };
  return { ok: true, out: r.stdout };
}

const relTo = (dir, p) => path.relative(dir, path.isAbsolute(p) ? p : path.join(dir, p)).split(path.sep).join('/');

function fill(template, vars) {
  const out = [];
  for (const w of shellWords(template)) {
    const m = /^\{(related|tests|files)\}$/.exec(w);
    if (m) out.push(...vars[m[1]]); else out.push(w);
  }
  return out;
}

function goPackages(dir) {
  const r = runCapture('go', ['list', '-deps', '-test', '-json', './...'], dir);
  if (!r.ok) return null;
  const pkgs = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < r.out.length; i++) {
    const c = r.out[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}' && --depth === 0) pkgs.push(JSON.parse(r.out.slice(start, i + 1)));
  }
  return pkgs;
}

const ADAPTERS = {
  vitest: {
    local: false,
    resolve(pkg, root, rels) {
      const dir = path.join(root, pkg.dir);
      const r = wrapped(root, pkg, ['node', path.join(HERE, 'vitest_related.mjs'), dir, ...rels], root);
      if (!r.ok) return { error: r.err || 'vitest_related.mjs failed' };
      try { return { map: JSON.parse(r.out) }; } catch { return { error: 'vitest_related.mjs gave no JSON' }; }
    },
    argv(pkg, root, { related, tests }) {
      const pre = pkg.cmd && !/\{/.test(pkg.cmd) ? shellWords(pkg.cmd) : [...pmPrefix(root, pkg), 'vitest'];
      if (pkg.cmd && /\{/.test(pkg.cmd)) return fill(pkg.cmd, { related, tests, files: [...related, ...tests] });
      return related.length ? [...pre, 'related', '--run', ...related, ...tests] : [...pre, 'run', ...tests];
    },
  },
  jest: {
    local: false,
    resolve(pkg, root, rels) {
      const pre = pkg.cmd && !/\{/.test(pkg.cmd) ? shellWords(pkg.cmd) : [...pmPrefix(root, pkg), 'jest'];
      const dir = path.join(root, pkg.dir);
      const r = wrapped(root, pkg, [...pre, '--listTests', '--findRelatedTests', ...rels], dir);
      if (!r.ok) return { error: r.err || 'jest --listTests failed' };
      return { set: r.out.split('\n').filter((l) => l.trim()).map((l) => relTo(dir, l.trim())) };
    },
    argv(pkg, root, { related, tests }) {
      if (pkg.cmd && /\{/.test(pkg.cmd)) return fill(pkg.cmd, { related, tests, files: [...related, ...tests] });
      const pre = pkg.cmd ? shellWords(pkg.cmd) : [...pmPrefix(root, pkg), 'jest'];
      return related.length ? [...pre, '--findRelatedTests', ...related, ...tests] : [...pre, ...tests];
    },
  },
  pytest: {
    local: true,
    resolve(pkg, root, rels, all) {
      const dir = path.join(root, pkg.dir);
      const py = process.env.PYTHON || 'python3';
      const r = runCapture(py, [path.join(HERE, 'py_related.py')], dir, JSON.stringify({ root: dir, tests: all, changed: rels }));
      if (!r.ok) return { error: (r.err || 'py_related.py failed')  };
      return { map: JSON.parse(r.out).map };
    },
    argv(pkg, root, { tests, related }) {
      if (pkg.cmd && /\{/.test(pkg.cmd)) return fill(pkg.cmd, { related, tests, files: [...related, ...tests] });
      if (!tests.length) return null;
      const pre = pkg.cmd ? shellWords(pkg.cmd) : [process.env.PYTHON || 'python3', '-m', 'pytest'];
      return [...pre, ...tests];
    },
  },
  go: {
    local: true,
    resolve(pkg, root, rels) {
      const dir = path.join(root, pkg.dir);
      const pkgs = goPackages(dir);
      if (!pkgs) return { error: '`go list -deps -test -json ./...` failed' };
      const own = pkgs.filter((p) => p.Module && p.Module.Main && p.Dir && !p.ForTest && !/\.test$/.test(p.ImportPath));
      const bare = (s) => s.replace(/ \[.*\]$/, '');
      const byDir = new Map(own.map((p) => [path.resolve(p.Dir), p]));
      const rev = new Map(); // import path -> importer import paths
      const link = (from, to) => { if (!rev.has(to)) rev.set(to, new Set()); rev.get(to).add(from); };
      for (const p of own) for (const i of p.Imports || []) link(p.ImportPath, bare(i));
      const testsOf = (p) => [...(p.TestGoFiles || []), ...(p.XTestGoFiles || [])];
      const importers = new Map(); // for test edges
      for (const p of own) for (const i of [...(p.TestImports || []), ...(p.XTestImports || [])]) {
        if (!importers.has(bare(i))) importers.set(bare(i), new Set());
        importers.get(bare(i)).add(p.ImportPath);
      }
      const map = {};
      for (const rel of rels) {
        const p = byDir.get(path.resolve(dir, path.dirname(rel)));
        const hit = new Set();
        if (p) {
          const seen = new Set([p.ImportPath]);
          const stack = [p.ImportPath];
          while (stack.length) {
            const cur = stack.pop();
            for (const x of [...(rev.get(cur) || [])]) if (!seen.has(x)) { seen.add(x); stack.push(x); }
          }
          for (const ip of seen) {
            const q = own.find((o) => o.ImportPath === ip);
            if (q) for (const t of testsOf(q)) hit.add(relTo(dir, path.join(q.Dir, t)));
            for (const ip2 of importers.get(ip) || []) {
              const q2 = own.find((o) => o.ImportPath === ip2);
              if (q2) for (const t of testsOf(q2)) hit.add(relTo(dir, path.join(q2.Dir, t)));
            }
          }
        }
        map[rel] = [...hit].sort();
      }
      return { map };
    },
    argv(pkg, root, { tests, related }) {
      if (pkg.cmd && /\{/.test(pkg.cmd)) return fill(pkg.cmd, { related, tests, files: [...related, ...tests] });
      const dirs = [...new Set(tests.map((t) => './' + (path.posix.dirname(t) === '.' ? '' : path.posix.dirname(t))))].map((d) => (d === './' ? '.' : d));
      if (!dirs.length) return null;
      return [...(pkg.cmd ? shellWords(pkg.cmd) : ['go', 'test']), ...dirs];
    },
  },
  custom: {
    local: true,
    resolve(pkg, root, rels) {
      if (!pkg.relatedCmd) return { map: Object.fromEntries(rels.map((r) => [r, []])) };
      const dir = path.join(root, pkg.dir);
      const argv = fill(pkg.relatedCmd.includes('{') ? pkg.relatedCmd : pkg.relatedCmd + ' {files}', { related: rels, tests: [], files: rels });
      const r = runCapture(argv[0], argv.slice(1), dir);
      if (!r.ok) return { error: (r.err || 'relatedCmd failed')  };
      const map = Object.fromEntries(rels.map((x) => [x, []]));
      const set = [];
      let paired = false;
      for (const l of r.out.split('\n').filter((x) => x.trim())) {
        const [a, b] = l.split('\t');
        if (b !== undefined) { paired = true; (map[a] ||= []).push(b); } else set.push(a.trim());
      }
      return paired ? { map } : { set };
    },
    argv(pkg, root, { tests, related }) {
      if (!pkg.cmd) return null;
      return fill(pkg.cmd.includes('{') ? pkg.cmd : pkg.cmd + ' {files}', { related, tests, files: [...related, ...tests] });
    },
  },
  none: { local: true, resolve: (pkg, root, rels) => ({ map: Object.fromEntries(rels.map((r) => [r, []])) }), argv: () => null },
};

/** Fill the import-graph half of a selection. resolveHeavy: also call adapters that start the runner (vitest, jest). */
function resolveGraph(cfg, root, sel, all, { resolveHeavy = false } = {}) {
  for (const pkg of Object.values(cfg.packages)) {
    const rels = sel.related[pkg.name];
    if (!rels.length) continue;
    const ad = ADAPTERS[pkg.runner];
    if (!ad) { sel.graph[pkg.name] = 'none'; sel.warnings.push(`package ${pkg.name}: runner "${pkg.runner}" has no adapter, parts only`); continue; }
    if (!ad.local && !resolveHeavy) { sel.graph[pkg.name] = 'runtime'; continue; }
    const r = ad.resolve(pkg, root, rels, all[pkg.name]);
    if (r.error) { sel.graph[pkg.name] = 'runtime'; sel.warnings.push(`package ${pkg.name}: graph not resolved (${r.error}); the runner resolves it at run time`); continue; }
    sel.graph[pkg.name] = 'resolved';
    const live = (t) => all[pkg.name].includes(t) && !isExcluded(cfg, pkg.name, t);
    const repo = (rel) => (pkg.dir === '.' ? rel : `${pkg.dir}/${rel}`);
    if (r.map) {
      for (const rel of rels) {
        const tests = (r.map[rel] || []).filter(live);
        for (const t of tests) addEntry(sel, { part: '(graph)', pkg: pkg.name, file: t, reason: `related: ${repo(rel)}` });
        if (!tests.length && !(sel.srcHits[repo(rel)] || []).length) sel.uncovered.push(repo(rel));
      }
    } else {
      const tests = r.set.filter(live);
      for (const t of tests) addEntry(sel, { part: '(graph)', pkg: pkg.name, file: t, reason: 'related' });
      if (!tests.length) for (const rel of rels) if (!(sel.srcHits[repo(rel)] || []).length) sel.uncovered.push(repo(rel));
    }
  }
  sel.uncovered = [...new Set(sel.uncovered)].sort();
  return sel;
}

// ───────────────────────── args ─────────────────────────
const VALUE_FLAGS = new Set(['config', 'to', 'part', 'commits', 'results', 'since', 'source', 'out', 'root', 'limit']);
const OPT_VALUE_FLAGS = new Set(['changed']);
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (!x.startsWith('--')) { a._.push(x); continue; }
    const k = x.slice(2);
    if (VALUE_FLAGS.has(k)) { const v = argv[++i]; if (v === undefined) throw new Usage(`--${k} needs a value`); a[k] = v; }
    else if (OPT_VALUE_FLAGS.has(k)) { a[k] = true; if (argv[i + 1] && !argv[i + 1].startsWith('--')) a.base = argv[++i]; }
    else a[k] = true;
  }
  return a;
}

// ───────────────────────── render ─────────────────────────
function render(cfg, sel, header, all) {
  const out = [...header];
  out.push(`parts: ${sel.parts.join(', ') || '(none)'}${sel.runAll ? '  [run-all]' : ''}`);
  for (const pkg of Object.keys(cfg.packages)) {
    const es = sel.entries.filter((e) => e.pkg === pkg);
    const total = all[pkg].length;
    if (!es.length && !sel.related[pkg].length) continue;
    out.push(`${pkg} tests: ${es.length}${total ? ` of ${total}` : ''}`);
    for (const e of es) out.push(`  ${e.part.padEnd(14)} ${e.file}   (${e.reason})`);
    if (sel.related[pkg].length) {
      out.push(`  import graph sources: ${sel.related[pkg].join(', ')}`);
      if (sel.graph[pkg] === 'runtime') out.push(`  (${pkg}: related tests resolved by the ${cfg.packages[pkg].runner} runner at run time; pass --resolve to list them here)`);
    }
  }
  out.push(`checks: ${sel.checks.join(', ') || '(none)'}`);
  if (sel.noTests.length) out.push(`no tests needed: ${sel.noTests.length} file(s)`, ...sel.noTests.map((f) => `  ${f}`));
  if (sel.uncovered.length) out.push('uncovered changed files (no test selected, not in noTests):', ...sel.uncovered.map((f) => `  ${f}`));
  for (const w of sel.warnings) out.push(`warning: ${w}`);
  return out.join('\n');
}

function selectionFromArgs(a, root, cfg, all, files0) {
  if (a.part) return { sel: selectParts(cfg, a.part.split(',').filter(Boolean), all), header: [], meta: { mode: 'part', parts: a.part.split(',') } };
  if (!a.changed) throw new Usage('give --changed [base] [--to ref] or --part a,b');
  const base = resolveBase(root, cfg, a.base);
  const { files, deleted } = files0 || changedFiles(root, base, a.to);
  const sel = selectChanged(cfg, { files, deleted, depsChanged: depsChanged(root, files, base, a.to), all });
  return { sel, header: [`base: ${base}  to: ${a.to ?? 'working tree'}  changed files: ${files.length}`], meta: { mode: 'changed', base, to: a.to ?? 'working tree', changedFiles: files } };
}

const publicSel = (sel) => { const { srcHits, ...rest } = sel; return rest; };

// ───────────────────────── subcommands ─────────────────────────
function cmdSelect(a, root, cfg, all, { quiet = false } = {}) {
  const { sel, header, meta } = selectionFromArgs(a, root, cfg, all);
  if (a.changed) resolveGraph(cfg, root, sel, all, { resolveHeavy: !!a.resolve });
  sel.warnings.unshift(...cfg.warnings);
  if (!quiet) {
    if (a.json) console.log(JSON.stringify({ ...meta, selection: publicSel(sel), counts: Object.fromEntries(Object.keys(cfg.packages).map((p) => [p, sel.entries.filter((e) => e.pkg === p).length])) }, null, 2));
    else console.log(render(cfg, sel, header, all));
  }
  return { sel, code: sel.uncovered.length ? 3 : 0 };
}

function runCommand(label, argv, cwd, dry) {
  console.log(`\n== ${label}\n$ ${argv.join(' ').slice(0, 400)}${argv.join(' ').length > 400 ? ' …' : ''}`);
  if (dry) return true;
  const r = spawnSync(argv[0], argv.slice(1), { cwd, stdio: 'inherit' });
  return r.status === 0;
}

function wrapperArgv(root, pkg) {
  if (!pkg.wrapper) return [];
  const w = shellWords(pkg.wrapper);
  const abs = path.join(root, w[0]);
  if (!path.isAbsolute(w[0]) && fs.existsSync(abs)) w[0] = abs;
  return w;
}

function cmdRun(a, root, cfg, all) {
  if (a.part && a.changed) throw new Usage('--part and --changed are exclusive');
  const { sel, code } = cmdSelect(a, root, cfg, all);
  if (code) { console.error(`\ntest-scope: ${sel.uncovered.length} uncovered changed file(s): add them to a part's paths or to noTests`); return 3; }
  const results = [];
  for (const pkg of Object.values(cfg.packages)) {
    const tests = sel.entries.filter((e) => e.pkg === pkg.name).map((e) => e.file);
    const related = sel.related[pkg.name];
    if (!tests.length && !related.length) continue;
    const ad = ADAPTERS[pkg.runner];
    const argv = ad && ad.argv(pkg, root, { tests, related });
    if (!argv) { results.push({ label: `${pkg.name}: no runner command (runner "${pkg.runner}")`, ok: !tests.length && !related.length ? true : false }); continue; }
    results.push({ label: `${pkg.name} tests (${related.length} related sources, ${tests.length} test files)`, ok: runCommand(`${pkg.name} tests`, [...wrapperArgv(root, pkg), ...argv], path.join(root, pkg.dir), a['dry-run']) });
  }
  for (const c of sel.checks) {
    const [head, ...rest] = c.split(':');
    const pkg = cfg.packages[head];
    let argv, cwd = root;
    if (pkg && rest.length) { argv = [...(pmPrefix(root, pkg)[0] === 'pnpm' ? ['pnpm'] : pmPrefix(root, pkg)[0] === 'yarn' ? ['yarn'] : ['npm']), 'run', rest.join(':')]; cwd = path.join(root, pkg.dir); }
    else argv = shellWords(c);
    results.push({ label: `check ${c}`, ok: runCommand(`check ${c}`, argv, cwd, a['dry-run']) });
  }
  console.log('\n== summary');
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.label}`);
  if (!results.length) console.log('nothing to run');
  return results.every((r) => r.ok) ? 0 : 1;
}

function cmdCoverage(root, cfg, all, files) {
  const problems = [];
  const unowned = [], dead = [];
  for (const pkg of Object.keys(cfg.packages)) {
    for (const f of all[pkg]) {
      if (isExcluded(cfg, pkg, f)) continue;
      const owned = Object.values(cfg.parts).some((p) => matchAny(f, p.tests[pkg] || [])) || matchAny(f, cfg.graphOnly[pkg] || []);
      if (!owned) unowned.push(`${pkg}: ${f}`);
    }
    for (const [pn, part] of Object.entries(cfg.parts)) for (const g of part.tests[pkg] || []) if (!all[pkg].some((f) => matchGlob(f, g))) dead.push(`parts.${pn}.tests.${pkg}: ${g}`);
    for (const g of cfg.graphOnly[pkg] || []) if (!all[pkg].some((f) => matchGlob(f, g))) dead.push(`graphOnly.${pkg}: ${g}`);
    if (!all[pkg].length) problems.push(`package ${pkg}: no test files found (testGlobs ${JSON.stringify(cfg.packages[pkg].testGlobs)})`);
  }
  for (const [pn, part] of Object.entries(cfg.parts)) for (const g of part.paths) if (!g.startsWith('!') && !files.some((f) => matchGlob(f, g))) dead.push(`parts.${pn}.paths: ${g}`);
  for (const k of ['noTests', 'runAll']) for (const g of cfg[k]) if (!files.some((f) => matchGlob(f, g))) dead.push(`${k}: ${g}`);
  const total = Object.values(all).reduce((n, v) => n + v.length, 0);
  console.log(`test files: ${total} in ${Object.keys(cfg.packages).length} package(s); parts: ${Object.keys(cfg.parts).length}`);
  if (unowned.length) console.log(`UNOWNED test files (${unowned.length}): add to a part's tests or to graphOnly\n${unowned.map((x) => `  ${x}`).join('\n')}`);
  if (dead.length) console.log(`DEAD globs (${dead.length}): match nothing, so they select nothing\n${dead.map((x) => `  ${x}`).join('\n')}`);
  for (const p of problems) console.log(`PROBLEM ${p}`);
  for (const w of cfg.warnings) console.log(`warning: ${w}`);
  if (unowned.length || dead.length || problems.length) return 1;
  console.log('coverage clean');
  return 0;
}

function commitRange(root, n, since) {
  const args = since ? ['rev-list', '--first-parent', `${since}..HEAD`] : ['rev-list', '--first-parent', '-n', String(n), 'HEAD'];
  return lines(git(root, args));
}

function selectForCommit(root, cfg, all, sha, resolveHeavy) {
  const parent = gitOk(root, ['rev-parse', '--verify', '-q', `${sha}~1`]);
  const base = parent ? parent.trim() : EMPTY_TREE;
  const { files, deleted } = changedFiles(root, base, sha);
  const sel = selectChanged(cfg, { files, deleted, depsChanged: depsChanged(root, files, base, sha), all });
  // resolved against the checked-out tree: files that no longer exist are skipped by the adapters
  for (const p of Object.keys(sel.related)) sel.related[p] = sel.related[p].filter((rel) => fs.existsSync(path.join(root, cfg.packages[p].dir, rel)));
  resolveGraph(cfg, root, sel, all, { resolveHeavy });
  return { files, sel };
}

const pct = (xs, q) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.max(0, Math.ceil(q * s.length) - 1)] : 0; };

function cmdReplay(a, root, cfg, all) {
  const n = parseInt(a.commits || '10', 10);
  if (!(n > 0)) throw new Usage('--commits needs a positive number');
  const total = Object.values(all).reduce((k, v) => k + v.length, 0);
  const rows = [];
  for (const sha of commitRange(root, n)) {
    const { files, sel } = selectForCommit(root, cfg, all, sha, !!a.resolve);
    const selected = sel.entries.length;
    const lower = Object.values(sel.graph).includes('runtime');
    rows.push({
      sha: sha.slice(0, 7), subject: git(root, ['log', '-1', '--format=%s', sha]).trim(), changed: files.length, selected, total,
      percent: total ? Math.round((1000 * selected) / total) / 10 : 0, runAll: sel.runAll, uncovered: sel.uncovered.length, lowerBound: lower,
    });
  }
  const sizes = rows.map((r) => r.selected), pcts = rows.map((r) => r.percent);
  const summary = { commits: rows.length, totalTestFiles: total, median: pct(sizes, 0.5), p90: pct(sizes, 0.9), max: Math.max(0, ...sizes), medianPercent: pct(pcts, 0.5), p90Percent: pct(pcts, 0.9), maxPercent: Math.max(0, ...pcts), runAllCommits: rows.filter((r) => r.runAll).length, lowerBoundCommits: rows.filter((r) => r.lowerBound).length };
  if (a.json) { console.log(JSON.stringify({ summary, commits: rows }, null, 2)); return 0; }
  console.log(`replay: last ${rows.length} first-parent commit(s); graph resolved against the checked-out tree; full suite = ${total} test file(s)`);
  for (const r of rows) console.log(`${r.sha}  ${String(r.changed).padStart(3)} files  ${String(r.selected).padStart(4)} / ${total} tests  ${String(r.percent).padStart(5)}%${r.lowerBound ? '+' : ' '}${r.runAll ? '  [run-all]' : ''}${r.uncovered ? `  [${r.uncovered} uncovered]` : ''}  ${r.subject.slice(0, 60)}`);
  console.log(`median ${summary.median} (${summary.medianPercent}%)   p90 ${summary.p90} (${summary.p90Percent}%)   max ${summary.max} (${summary.maxPercent}%)   run-all commits ${summary.runAllCommits}`);
  if (summary.lowerBoundCommits) console.log(`'+' = lower bound: ${summary.lowerBoundCommits} commit(s) touched a package whose runner resolves related tests at run time (vitest/jest); only parts are counted. --resolve counts them (starts the runner).`);
  return 0;
}

// ── misses ──
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function parseResults(text) {
  const t = text.trimStart();
  const failing = new Set();
  if (t.startsWith('<')) {
    const suites = [...t.matchAll(/<testsuite\b([^>]*)>/g)];
    const attr = (s, k) => { const m = new RegExp(`\\b${k}="([^"]*)"`).exec(s); return m ? unesc(m[1]) : null; };
    for (const m of t.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      if (!m[3] || !/<(failure|error)\b/.test(m[3])) continue;
      const file = attr(m[1], 'file');
      if (file) { failing.add(file); continue; }
      const cls = attr(m[1], 'classname');
      if (cls) { failing.add({ classname: cls }); continue; }
      const before = suites.filter((s) => s.index < m.index).pop();
      if (before && attr(before[1], 'name')) failing.add(attr(before[1], 'name'));
    }
    return [...failing];
  }
  if (t.startsWith('{') && /"testResults"/.test(t) && !/^\{"Time"/.test(t)) {
    const j = JSON.parse(text);
    for (const r of j.testResults || []) if (r.status === 'failed' || (r.assertionResults || []).some((x) => x.status === 'failed')) failing.add(r.name || r.testFilePath);
    return [...failing];
  }
  for (const l of text.split('\n')) {
    if (!l.trim().startsWith('{')) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.Action === 'fail' && j.Package) failing.add(j.Test ? { goPackage: j.Package, test: j.Test } : { goPackage: j.Package });
  }
  return [...failing];
}

function mapFailures(root, cfg, all, raw) {
  const repoTests = Object.entries(all).flatMap(([pkg, ts]) => ts.map((t) => ({ pkg, rel: t, repo: cfg.packages[pkg].dir === '.' ? t : `${cfg.packages[pkg].dir}/${t}` })));
  const found = new Map();
  const add = (t, why) => { if (!found.has(t.repo)) found.set(t.repo, { ...t, why }); };
  const unknown = [];
  for (const f of raw) {
    if (typeof f === 'string') {
      const rel = path.isAbsolute(f) ? path.relative(root, f).split(path.sep).join('/') : f.replace(/^\.\//, '');
      const hit = repoTests.filter((t) => t.repo === rel || rel.endsWith('/' + t.repo) || t.repo.endsWith('/' + rel) || t.rel === rel);
      if (hit.length) hit.forEach((t) => add(t, rel)); else unknown.push(f);
    } else if (f.classname) {
      const guess = f.classname.split('.');
      let hit = [];
      for (let k = guess.length; k > 0 && !hit.length; k--) {
        const p = guess.slice(0, k).join('/');
        hit = repoTests.filter((t) => { const stem = t.repo.replace(/(\.(test|spec))?\.[^./]+$/, ''); return stem === p || stem.endsWith('/' + p); });
      }
      if (hit.length) hit.forEach((t) => add(t, f.classname)); else unknown.push(f.classname);
    } else if (f.goPackage) {
      const tail = f.goPackage.split('/');
      let hit = [];
      for (let k = tail.length; k > 0 && !hit.length; k--) {
        const d = tail.slice(tail.length - k).join('/');
        hit = repoTests.filter((t) => /_test\.go$/.test(t.repo) && (path.posix.dirname(t.repo) === d || path.posix.dirname(t.repo).endsWith('/' + d)));
      }
      if (hit.length) hit.forEach((t) => add(t, f.goPackage)); else unknown.push(f.goPackage);
    }
  }
  return { failing: [...found.values()], unknown };
}

const STOP = new Set(['test', 'tests', 'spec', 'src', 'index', 'lib', 'main', 'app', 'js', 'ts', 'tsx', 'jsx', 'py', 'go', 'mjs', 'cjs', 'live', 'unit', 'e2e', 'the', 'and', 'of']);
const tokens = (p) => [...new Set(p.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t)))];

function importedBases(root, testRepo) {
  let src = '';
  try { src = fs.readFileSync(path.join(root, testRepo), 'utf8'); } catch { return { names: [], text: '' }; }
  const names = new Set();
  for (const m of src.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)) names.add(m[1]);
  for (const m of src.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) names.add((m[1] || m[2]).replace(/\./g, '/'));
  return { names: [...names].map((n) => path.posix.basename(n).replace(/\.[^.]+$/, '')).filter((n) => n && n !== '.' && n !== '..'), text: src };
}

function cmdMisses(a, root, cfg, all) {
  if (!a.results) throw new Usage('misses needs --results <junit.xml|vitest.json|go-test.json>');
  const text = fs.readFileSync(path.resolve(a.results), 'utf8');
  const { failing, unknown } = mapFailures(root, cfg, all, parseResults(text));
  const commits = commitRange(root, parseInt(a.commits || '50', 10), a.since);
  const perCommit = commits.map((sha) => ({ sha, ...selectForCommit(root, cfg, all, sha, !!a.resolve) }));
  const report = [];
  for (const t of failing) {
    const sel = perCommit.filter((c) => c.sel.entries.some((e) => e.pkg === t.pkg && e.file === t.rel)).map((c) => c.sha.slice(0, 7));
    const unresolved = perCommit.some((c) => c.sel.graph[t.pkg] === 'runtime');
    const owner = Object.entries(cfg.parts).find(([, p]) => matchAny(t.rel, p.tests[t.pkg] || []))?.[0] || null;
    if (sel.length) { report.push({ test: t.repo, verdict: 'SELECTED', commits: sel, owner }); continue; }
    const imp = importedBases(root, t.repo);
    const tt = tokens(t.repo);
    const scored = [];
    for (const c of perCommit) {
      let best = 0, bestFile = null;
      for (const f of c.files) {
        const base = path.posix.basename(f).replace(/\.[^.]+$/, '');
        let s = tokens(f).filter((x) => tt.includes(x)).length;
        if (imp.names.includes(base)) s += 3;
        if (base.length > 3 && imp.text.includes(base)) s += 2;
        if (s > best) { best = s; bestFile = f; }
      }
      if (best > 0) scored.push({ commit: c.sha.slice(0, 7), score: best, file: bestFile });
    }
    scored.sort((x, y) => y.score - x.score);
    const culprits = scored.slice(0, 5);
    const proposal = culprits.length
      ? (owner ? `part "${owner}": add paths ${JSON.stringify(culprits[0].file)} (narrowest glob that selects ${t.repo}); confirm the link before writing` : `no part owns ${t.repo}: add it to a part's tests, then paths ${JSON.stringify(culprits[0].file)}`)
      : 'no changed file in range shares a name or import with this test: no link found, do not add a broad glob';
    report.push({ test: t.repo, verdict: unresolved ? 'UNKNOWN' : 'MISS', commits: [], owner, culprits, proposal, note: unresolved ? 'import graph not resolved for this package (vitest/jest): rerun with --resolve before calling it a miss' : undefined });
  }
  if (a.json) { console.log(JSON.stringify({ commitsWalked: commits.length, failing: report, unmapped: unknown }, null, 2)); }
  else {
    console.log(`misses: ${failing.length} failing test file(s), ${commits.length} commit(s) walked${a.since ? ` since ${a.since}` : ''}`);
    for (const r of report) {
      console.log(`${r.verdict.padEnd(8)} ${r.test}${r.owner ? `  [part ${r.owner}]` : ''}`);
      if (r.verdict === 'SELECTED') console.log(`         selected by: ${r.commits.join(', ')}`);
      else {
        if (r.note) console.log(`         ${r.note}`);
        for (const c of r.culprits) console.log(`         likely culprit ${c.commit}  ${c.file}  (score ${c.score})`);
        console.log(`         proposal: ${r.proposal}`);
      }
    }
    for (const u of unknown) console.log(`unmapped failure (no test file found in inventory): ${u}`);
    console.log('proposals only: nothing was edited.');
  }
  return report.some((r) => r.verdict === 'MISS') || unknown.length ? 1 : 0;
}

// ── rules ──
const literalPrefix = (g) => { const i = g.search(/[*?]/); return i < 0 ? g : g.slice(0, i); };
export function partsForRulePath(cfg, ruleGlob) {
  const rule = expandBraces(ruleGlob);
  return Object.entries(cfg.parts).filter(([, part]) => rule.some((r) => {
    if (!/[*?]/.test(r)) return matchesPaths(r, part.paths);
    const rp = literalPrefix(r);
    return part.paths.filter((p) => !p.startsWith('!')).flatMap(expandBraces).some((pp) => { const pl = literalPrefix(pp); return pl.startsWith(rp) || rp.startsWith(pl); });
  })).map(([n]) => n);
}

export function generateRules(source, cfg) {
  const known = new Set(Object.keys(cfg.parts));
  const rules = source.rules.map((r) => {
    let line;
    if (r.testParts !== undefined) {
      if (/^[\w:.,-]+$/.test(r.testParts)) {
        const unknown = r.testParts.split(',').filter((n) => !known.has(n));
        if (unknown.length) throw new Error(`rule ${r.path}: unknown part ${unknown.join(', ')}`);
      }
      line = `Test parts: ${r.testParts}`;
    } else {
      const names = partsForRulePath(cfg, r.path);
      if (!names.length) throw new Error(`rule ${r.path}: no part's paths intersect it; give it an explicit testParts`);
      line = `Test parts: ${names.join(',')}`;
    }
    return { path: r.path, rule: `${r.rule}\n\n${source.testPartsFooter ? source.testPartsFooter + '\n' : ''}${line}` };
  });
  const out = {};
  if (source._comment) out._comment = source._comment;
  out.include = source.include || [];
  out.exclude = source.exclude || [];
  out.rules = rules;
  return JSON.stringify(out, null, 2) + '\n';
}

function cmdRules(a, root, cfg) {
  const sourceFile = path.resolve(root, a.source || '.test-scope/rules.source.json');
  const target = path.resolve(root, a.out || '.opencodereview/rule.json');
  if (!a.write && !a.check) throw new Usage('rules needs --write or --check');
  if (!fs.existsSync(sourceFile)) throw new Usage(`${path.relative(root, sourceFile)} not found (shape: assets/rules.source.example.json)`);
  const source = readJson(sourceFile);
  const rel = path.relative(root, target);
  let want;
  try { want = generateRules(source, cfg); } catch (e) { console.error(`rules: ${e.message}`); return 1; }
  if (a.check) {
    if (!fs.existsSync(target)) { console.error(`rules: ${rel} is missing: run rules --write`); return 1; }
    if (fs.readFileSync(target, 'utf8') !== want) { console.error(`rules: ${rel} is stale: run rules --write`); return 1; }
    console.log(`rules: ${rel} is current`);
    return 0;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, want);
  console.log(`rules: wrote ${rel} (${source.rules.length} rules)`);
  return 0;
}

// ── detect ──
function cmdDetect(a, root) {
  const files = repoFiles(root).filter((f) => !/(^|\/)node_modules\//.test(f));
  const dirs = new Set(['.']);
  for (const f of files) if (/(^|\/)(package\.json|pyproject\.toml|go\.mod|pytest\.ini|setup\.cfg)$/.test(f) && f.split('/').length <= 4) dirs.add(path.posix.dirname(f));
  const pkgs = [];
  for (const dir of [...dirs].sort()) {
    const runner = guessRunner(dir, root);
    const globs = DEFAULT_TEST_GLOBS[runner] || [];
    const under = files.filter((f) => (dir === '.' || f.startsWith(dir + '/')) && !(dir === '.' && [...dirs].some((d) => d !== '.' && f.startsWith(d + '/') && guessRunner(d, root) !== 'none')));
    const tests = under.filter((f) => matchAny(dir === '.' ? f : f.slice(dir.length + 1), globs));
    if (runner === 'none' && !tests.length) continue;
    pkgs.push({ name: dir === '.' ? 'root' : path.posix.basename(dir), dir, runner, testFiles: tests.length });
  }
  const wrappers = files.filter((f) => /(^|\/)(scripts\/)?(heavy|lock|nice|with-lock)[\w.-]*\.(sh|mjs|js)$/.test(f) || /^Makefile$/.test(f));
  const ci = files.filter((f) => /^(\.github\/workflows\/.*\.ya?ml|\.gitlab-ci\.yml|Jenkinsfile|\.circleci\/config\.yml|azure-pipelines\.yml)$/.test(f));
  const existing = ['.test-scope/parts.json', '.test-scope/rules.source.json', '.opencodereview/rule.json'].filter((f) => fs.existsSync(path.join(root, f)));
  const out = { root, packages: pkgs, wrappers, ci, existing, suggestedPackages: Object.fromEntries(pkgs.filter((p) => p.runner !== 'none').map((p) => [p.name, { dir: p.dir, runner: p.runner }])) };
  if (a.json) { console.log(JSON.stringify(out, null, 2)); return 0; }
  console.log(`repo: ${root}`);
  for (const p of pkgs) console.log(`package ${p.name.padEnd(14)} dir ${p.dir.padEnd(16)} runner ${p.runner.padEnd(7)} test files ${p.testFiles}`);
  if (!pkgs.length) console.log('no package with a known runner found (custom runner: see references/adapters.md)');
  console.log(`lock/wrapper candidates: ${wrappers.join(', ') || '(none)'}`);
  console.log(`CI files: ${ci.join(', ') || '(none)'}`);
  console.log(`existing test-scope files: ${existing.join(', ') || '(none)'}`);
  console.log(`suggested "packages": ${JSON.stringify(out.suggestedPackages)}`);
  return 0;
}

// ───────────────────────── main ─────────────────────────
const USAGE = `usage: test-scope.mjs <detect|select|run|coverage|replay|misses|rules> [options]
  select --changed [base] [--to ref] [--list|--json] [--resolve]   run --part a,b | --changed [base] [--to ref] [--dry-run]
  coverage   replay --commits N [--json] [--resolve]   misses --results <file> [--since ref] [--commits N]   rules --write|--check
  global: --config <path>  --root <dir>`;

export function main(argv) {
  const a = parseArgs(argv);
  const sub = a._[0];
  if (!sub || sub === 'help' || a.help) { console.log(USAGE); return sub ? 0 : 64; }
  const root = a.root ? path.resolve(a.root) : repoRoot(process.cwd());
  if (sub === 'detect') return cmdDetect(a, root);
  if (!['select', 'run', 'coverage', 'replay', 'misses', 'rules'].includes(sub)) throw new Usage(`unknown subcommand: ${sub}`);
  const cfg = loadConfig(root, a.config);
  if (sub === 'rules') return cmdRules(a, root, cfg);
  const files = repoFiles(root);
  const all = listAllTests(cfg, files);
  if (sub === 'select') return cmdSelect(a, root, cfg, all).code;
  if (sub === 'run') return cmdRun(a, root, cfg, all);
  if (sub === 'coverage') return cmdCoverage(root, cfg, all, files);
  if (sub === 'replay') return cmdReplay(a, root, cfg, all);
  return cmdMisses(a, root, cfg, all);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main(process.argv.slice(2))); }
  catch (e) {
    if (e instanceof Usage) { console.error(`test-scope: ${e.message}`); process.exit(64); }
    console.error(`test-scope: ${e && e.stack ? e.stack : e}`); process.exit(2);
  }
}

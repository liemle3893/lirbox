// Workspace monorepos (pnpm-workspace.yaml, package.json "workspaces", lerna.json): package name -> dir, the
// dependency graph between workspace packages, and how a dependent sees an upstream package's code:
// "src" (an alias in its runner config, or exports pointing at sources) or "dist" (exports/main/module point at
// build output, so the dependent's tests need a fresh build). No dependencies.
import fs from 'node:fs';
import path from 'node:path';

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const RUNNER_CONFIGS = /^(vitest|vite|jest)\.(config|workspace)\.[cm]?[jt]s$/;
const CODE = /\.[cm]?[jt]sx?$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const readJson = (f) => { const t = readText(f); if (t === null) return null; try { return JSON.parse(t); } catch { return null; } };
/** JSON with comments and trailing commas (tsconfig). */
const readJsonc = (f) => {
  const t = readText(f);
  if (t === null) return null;
  try { return JSON.parse(t.replace(/\/\*[\s\S]*?\*\/|("(?:\\.|[^"\\])*")|\/\/[^\n]*/g, (m, s) => s || '').replace(/,(\s*[}\]])/g, '$1')); } catch { return null; }
};

/** `packages:` of a pnpm-workspace.yaml: block list or inline flow list. */
export function pnpmGlobs(text) {
  const out = [];
  const ls = text.split('\n');
  for (let i = 0; i < ls.length; i++) {
    const m = /^packages\s*:\s*(.*)$/.exec(ls[i]);
    if (!m) continue;
    const inline = m[1].replace(/#.*$/, '').trim();
    if (inline.startsWith('[')) return inline.slice(1, inline.lastIndexOf(']')).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    for (let j = i + 1; j < ls.length; j++) {
      const l = ls[j];
      if (/^\S/.test(l) && !/^#/.test(l)) break;
      const it = /^\s*-\s*(.+?)\s*$/.exec(l.replace(/\s#.*$/, ''));
      if (it) out.push(it[1].replace(/^['"]|['"]$/g, ''));
    }
    return out;
  }
  return out;
}

function workspaceGlobs(root) {
  const y = readText(path.join(root, 'pnpm-workspace.yaml'));
  if (y !== null) return { pm: 'pnpm', globs: pnpmGlobs(y) };
  const j = readJson(path.join(root, 'package.json')) || {};
  const pm = fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(root, 'bun.lock')) || fs.existsSync(path.join(root, 'bun.lockb')) ? 'bun' : fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
  const w = Array.isArray(j.workspaces) ? j.workspaces : j.workspaces && Array.isArray(j.workspaces.packages) ? j.workspaces.packages : null;
  if (w) return { pm, globs: w };
  const lerna = readJson(path.join(root, 'lerna.json'));
  if (lerna && Array.isArray(lerna.packages)) return { pm, globs: lerna.packages };
  return null;
}

/** Runtime entry targets of a package.json (exports leaves except types, main, module), repo-relative. */
function entryTargets(dir, j) {
  const t = new Set();
  const walk = (v, key) => {
    if (typeof v === 'string') { if (key !== 'types' && key !== 'typings' && !/\.d\.[cm]?ts$/.test(v)) t.add(v); }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  if (j.exports !== undefined) walk(j.exports, null);
  for (const k of ['main', 'module']) if (typeof j[k] === 'string') t.add(j[k]);
  return [...t].map((x) => path.posix.normalize(path.posix.join(dir, x.replace(/^\.\//, ''))));
}
const isSourceTarget = (t) => (/\.(ts|tsx|mts|cts)$/.test(t) && !/\.d\.[cm]?ts$/.test(t)) || /(^|\/)src\//.test(t);

/** null when the repo is not a workspace. `files`: repo-relative tracked + untracked files. */
export function detectWorkspace(root, files, matchGlob) {
  const w = workspaceGlobs(root);
  if (!w || !w.globs.length) return null;
  const pos = w.globs.filter((g) => !g.startsWith('!')).map((g) => g.replace(/^\.\//, '').replace(/\/$/, ''));
  const neg = w.globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1).replace(/^\.\//, '').replace(/\/$/, ''));
  const pkgs = new Map();
  for (const f of files) {
    if (!/(^|\/)package\.json$/.test(f) || /(^|\/)node_modules\//.test(f)) continue;
    const dir = path.posix.dirname(f);
    if (dir === '.' || !pos.some((g) => matchGlob(dir, g)) || neg.some((g) => matchGlob(dir, g))) continue;
    const j = readJson(path.join(root, f));
    if (!j || !j.name) continue;
    const targets = entryTargets(dir, j);
    const concrete = targets.filter((t) => !t.includes('*'));
    pkgs.set(j.name, { name: j.name, dir, json: j, targets: concrete, via: concrete.length ? (concrete.every(isSourceTarget) ? 'src' : 'dist') : null, hasBuild: !!(j.scripts && j.scripts.build), hasTest: !!(j.scripts && j.scripts.test) });
  }
  if (!pkgs.size) return null;
  const rev = new Map([...pkgs.keys()].map((n) => [n, new Set()]));
  for (const p of pkgs.values()) {
    for (const field of DEP_FIELDS) for (const [dep, spec] of Object.entries(p.json[field] || {})) {
      if (dep === p.name || !pkgs.has(dep) || /^(npm|file|link|git|https?):/.test(String(spec))) continue;
      rev.get(dep).add(p.name);
    }
  }
  const byDir = [...pkgs.values()].sort((a, b) => b.dir.length - a.dir.length);
  const aliasCache = new Map();
  const ws = {
    root, pm: w.pm, pkgs,
    pkgOfFile: (f) => byDir.find((p) => f.startsWith(p.dir + '/')) || null,
    /** Transitive dependents, nearest first. */
    dependentsOf(name) {
      const out = [], seen = new Set([name]), q = [name];
      while (q.length) for (const d of [...rev.get(q.shift())].sort()) if (!seen.has(d)) { seen.add(d); out.push(pkgs.get(d)); q.push(d); }
      return out;
    },
    /** Upstream packages first (topological), for building several changed packages in a safe order. */
    order(names) {
      const set = new Set(names), out = [], done = new Set();
      const visit = (n) => { if (done.has(n)) return; done.add(n); for (const f of DEP_FIELDS) for (const d of Object.keys(pkgs.get(n).json[f] || {})) if (set.has(d)) visit(d); out.push(n); };
      [...set].sort().forEach(visit);
      return out;
    },
    /** How dependent D resolves upstream P: 'src' | 'dist' | null (cannot tell). */
    via(P, D) { return aliasesSrc(D, P) ? 'src' : P.via; },
    aliasesSrc: (D, P) => aliasesSrc(D, P),
    /** Packages whose exports/main point at build output while dependents have no source alias for them. */
    staleRisks() {
      const out = [];
      for (const P of [...pkgs.values()].sort((a, b) => a.dir.localeCompare(b.dir))) {
        if (P.via !== 'dist') continue;
        const ds = ws.dependentsOf(P.name).filter((D) => !aliasesSrc(D, P)).map((D) => D.name);
        if (ds.length) out.push({ pkg: P.name, entry: P.targets.find((t) => !isSourceTarget(t)), dependents: ds });
      }
      return out;
    },
  };
  function aliasesSrc(D, P) {
    const key = `${D.name}\0${P.name}`;
    if (aliasCache.has(key)) return aliasCache.get(key);
    const dir = path.join(root, D.dir);
    let names = [];
    try { names = fs.readdirSync(dir).filter((f) => RUNNER_CONFIGS.test(f)); } catch {}
    const texts = names.map((f) => readText(path.join(dir, f)) || '');
    const named = new RegExp(`(['"\`^]${esc(P.name)}(['"\`/$(]|\\\\))|([{,\\s]${esc(P.name)}\\s*:)`);
    let hit = texts.some((t) => named.test(t) && /\bsrc\b/.test(t));
    if (!hit && texts.some((t) => /tsconfig-?paths|pathsToModuleNameMapper/i.test(t))) {
      // tsconfig "paths" count only when the runner is told to honour them (vite-tsconfig-paths, ts-jest)
      let f = path.join(dir, 'tsconfig.json');
      for (let i = 0; i < 4 && f && !hit; i++) {
        const j = readJsonc(f);
        if (!j) break;
        const paths = (j.compilerOptions && j.compilerOptions.paths) || {};
        hit = Object.entries(paths).some(([k, v]) => (k === P.name || k.startsWith(P.name + '/')) && [].concat(v).some((x) => !/(^|\/)dist\//.test(x)));
        f = typeof j.extends === 'string' && j.extends.startsWith('.') ? path.resolve(path.dirname(f), j.extends.endsWith('.json') ? j.extends : j.extends + '.json') : null;
      }
    }
    aliasCache.set(key, hit);
    return hit;
  }
  return ws;
}

/** Test files of dependent D (repo paths) whose local import closure names one of `names` as a package. */
export function scanTests(root, files, D, tests, names) {
  const inD = files.filter((f) => f.startsWith(D.dir + '/') && CODE.test(f) && !/(^|\/)node_modules\//.test(f));
  const set = new Set(inD);
  const named = new RegExp(`(?:from|import|require)\\s*\\(?\\s*['"](?:${names.map(esc).join('|')})(?:['"/])`);
  const rev = new Map();
  const seeds = [];
  for (const f of inD) {
    const t = readText(path.join(root, f)) || '';
    if (named.test(t)) seeds.push(f);
    for (const m of t.matchAll(/(?:from|import|require)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g)) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      const stem = base.replace(/\.[cm]?jsx?$/, '');
      const to = [base, ...['.ts', '.tsx', '.js', '.mjs', '.jsx', '.mts', '.cts', '.cjs'].flatMap((e) => [stem + e, `${base}/index${e}`])].find((x) => set.has(x));
      if (to) { if (!rev.has(to)) rev.set(to, []); rev.get(to).push(f); }
    }
  }
  const seen = new Set(seeds), q = [...seeds];
  while (q.length) for (const x of rev.get(q.shift()) || []) if (!seen.has(x)) { seen.add(x); q.push(x); }
  return tests.filter((t) => seen.has(t));
}

export const PREBUILD_TEMPLATES = { pnpm: 'pnpm --filter {name} build', yarn: 'yarn workspace {name} build', npm: 'npm run build --workspace {name}', bun: 'bun run --filter {name} build' };

// Import graphs for `trace`, `hubs` and `graphCuts`. JS/TS: esbuild metafile (esbuild_graph.mjs), Python: py_related.py
// (edges mode), Go: `go list -deps -test`. Every function takes the host bag `H` built by test-scope.mjs.
import path from 'node:path';

const CACHE = new Map();
const repoPath = (pkg, n) => (pkg.dir === '.' ? n : `${pkg.dir}/${n}`);

function finish(kind, edgesObj, tests, nodeOf) {
  const edges = new Map(Object.entries(edgesObj).map(([k, v]) => [k, [...v]]));
  const rev = new Map();
  for (const [from, tos] of edges) for (const to of tos) { if (!rev.has(to)) rev.set(to, []); rev.get(to).push(from); }
  return { kind, edges, rev, tests: new Set(tests), nodeOf };
}

function build(H, pkg) {
  const dir = path.join(H.root, pkg.dir);
  const tests = (H.all[pkg.name] || []).filter((t) => !H.isExcluded(pkg.name, t));
  if (pkg.runner === 'vitest' || pkg.runner === 'jest') {
    const x = H.wrapped(H.root, pkg, ['node', path.join(H.HERE, 'esbuild_graph.mjs'), dir, ...tests], H.root);
    if (!x.ok) return { error: `esbuild graph failed: ${x.err}` };
    let j;
    try { j = JSON.parse(x.out); } catch { return { error: 'esbuild_graph.mjs gave no JSON' }; }
    if (j.error) return { error: j.error };
    return finish('js', j.edges, tests, (s) => s);
  }
  if (pkg.runner === 'pytest') {
    const x = H.runCapture(process.env.PYTHON || 'python3', [path.join(H.HERE, 'py_related.py')], dir, JSON.stringify({ root: dir, tests: H.all[pkg.name], changed: [], edges: true }));
    if (!x.ok) return { error: `py_related.py failed: ${x.err}` };
    return finish('py', JSON.parse(x.out).edges, tests, (s) => s);
  }
  if (pkg.runner === 'go') {
    const pkgs = H.goPackages(dir);
    if (!pkgs) return { error: '`go list -deps -test -json ./...` failed' };
    const own = pkgs.filter((p) => p.Module && p.Module.Main && p.Dir && !p.ForTest && !/\.test$/.test(p.ImportPath));
    const bare = (s) => s.replace(/ \[.*\]$/, '');
    const dirOf = new Map(own.map((p) => [p.ImportPath, H.relTo(dir, p.Dir) || '.']));
    const edges = {};
    const testNodes = [];
    for (const p of own) {
      const me = dirOf.get(p.ImportPath);
      edges[me] = [...new Set((p.Imports || []).map((i) => dirOf.get(bare(i))).filter(Boolean))];
      for (const t of [...(p.TestGoFiles || []), ...(p.XTestGoFiles || [])]) {
        const node = H.relTo(dir, path.join(p.Dir, t));
        testNodes.push(node);
        edges[node] = [me, ...new Set([...(p.TestImports || []), ...(p.XTestImports || [])].map((i) => dirOf.get(bare(i))).filter(Boolean))];
      }
    }
    return finish('go', edges, testNodes.filter((t) => !H.isExcluded(pkg.name, t)), (s) => path.posix.dirname(s) === '.' ? '.' : path.posix.dirname(s));
  }
  return { error: `no import graph for runner "${pkg.runner}" (graphs: vitest/jest via esbuild, pytest, go)` };
}

export function buildGraph(H, pkg) {
  const key = `${H.root}|${pkg.name}`;
  if (!CACHE.has(key)) CACHE.set(key, build(H, pkg));
  return CACHE.get(key);
}

/** Predicate: is `node` a graphCuts hub (never a test file). */
export function cutPredicate(H, pkg, g) {
  const cuts = H.cfg.graphCuts;
  if (!cuts.length) return () => false;
  return (n) => !g.tests.has(n) && (H.matchAny(repoPath(pkg, n), cuts) || (g.kind === 'go' && H.matchAny(`${repoPath(pkg, n)}/_`, cuts)));
}

/** Reverse BFS from the targets. Cut nodes are reached but never expanded. -> {tests:Set, parent:Map(node -> next hop to a target)} */
export function reaching(g, targets, cut = () => false) {
  const parent = new Map(targets.map((t) => [t, null]));
  const queue = [...targets];
  const tests = new Set();
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q];
    for (const imp of g.rev.get(cur) || []) {
      if (parent.has(imp)) continue;
      parent.set(imp, cur);
      if (g.tests.has(imp)) tests.add(imp);
      if (cut(imp)) continue;
      queue.push(imp);
    }
  }
  return { tests, parent };
}
export function chainFrom(parent, test) {
  const out = [test];
  for (let n = parent.get(test); n !== null && n !== undefined; n = parent.get(n)) out.push(n);
  return out;
}

/** Shortest forward chain start -> target, or null. */
export function shortest(g, start, target) {
  const parent = new Map([[start, null]]);
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q];
    if (cur === target) break;
    for (const nx of g.edges.get(cur) || []) if (!parent.has(nx)) { parent.set(nx, cur); queue.push(nx); }
  }
  if (!parent.has(target)) return null;
  const out = [];
  for (let n = target; n !== null; n = parent.get(n)) out.unshift(n);
  return out;
}

const notMeasurable = (m) => { console.log(`not measurable: ${m}`); return 4; };

export function cmdTrace(a, H) {
  const [, testArg, srcArg] = a._;
  if (!testArg || !srcArg) throw new H.Usage('trace needs <test-file> <source-file> (repo-root relative)');
  const t = H.pkgOf(testArg), s = H.pkgOf(srcArg);
  if (!t || !s || t.pkg !== s.pkg) throw new H.Usage('trace: both files must belong to one configured package');
  const g = buildGraph(H, t.pkg);
  if (g.error) return notMeasurable(`trace: ${g.error}`);
  const target = g.nodeOf(s.rel);
  const chain = shortest(g, t.rel, target);
  if (a.json) { console.log(JSON.stringify({ test: testArg, source: srcArg, chain: chain && chain.map((n) => repoPath(t.pkg, n)) }, null, 2)); return chain ? 0 : 1; }
  if (!chain) { console.log(`trace: no import path from ${testArg} to ${srcArg} (package ${t.pkg.name}, ${g.kind} graph). If a test still must run for it, that link is a hidden link: a part's paths.`); return 1; }
  const cut = cutPredicate(H, t.pkg, g);
  console.log(`trace: ${testArg} -> ${srcArg}  (${chain.length - 1} hop(s), ${g.kind} graph, package ${t.pkg.name})`);
  chain.forEach((n, i) => console.log(`  ${i ? '-> ' : '   '}${repoPath(t.pkg, n)}${i && i < chain.length - 1 && cut(n) ? '   [graphCut]' : ''}`));
  return 0;
}

/** hubs --changed [base] [--to ref] | --source <file[,file]> */
export function cmdHubs(a, H) {
  const perPkg = new Map(); // pkg name -> {pkg, sources: [rel]}
  let partTests = new Set();
  const add = (pkg, rel) => { if (!perPkg.has(pkg.name)) perPkg.set(pkg.name, { pkg, sources: [] }); const e = perPkg.get(pkg.name); if (!e.sources.includes(rel)) e.sources.push(rel); };
  if (a.source) {
    for (const f of a.source.split(',').filter(Boolean)) { const p = H.pkgOf(f); if (!p) throw new H.Usage(`hubs: ${f} is outside every configured package`); add(p.pkg, p.rel); }
  } else if (a.changed) {
    const { sel } = H.changedSel(a);
    for (const [name, rels] of Object.entries(sel.related)) for (const r of rels) add(H.cfg.packages[name], r);
    partTests = new Set(sel.entries.filter((e) => !e.part.startsWith('(')).map((e) => `${e.pkg}:${e.file}`));
  } else throw new H.Usage('hubs needs --changed [base] [--to ref] or --source <file>');
  if (!perPkg.size) { console.log('hubs: no changed source file reaches the import graph (nothing to trace)'); return 0; }
  const report = [];
  let code = 0;
  for (const { pkg, sources } of perPkg.values()) {
    const g = buildGraph(H, pkg);
    if (g.error) { console.log(`not measurable: hubs (${pkg.name}): ${g.error}`); code = 4; continue; }
    const targets = [...new Set(sources.map(g.nodeOf))];
    const full = reaching(g, targets);
    const counts = new Map();
    for (const t of full.tests) for (const n of chainFrom(full.parent, t).slice(1, -1)) counts.set(n, (counts.get(n) || 0) + 1);
    const ranked = [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 10).map(([node, chains]) => {
      const cut = reaching(g, targets, (n) => n === node);
      const only = [...full.tests].filter((t) => !cut.tests.has(t));
      return { node: repoPath(pkg, node), chains, share: Math.round((1000 * chains) / (full.tests.size || 1)) / 10, onlyVia: only.length, keptByParts: only.filter((t) => partTests.has(`${pkg.name}:${t}`)).length };
    });
    const chains = [...full.tests].sort().map((t) => ({ test: repoPath(pkg, t), chain: chainFrom(full.parent, t).map((n) => repoPath(pkg, n)) }));
    report.push({ package: pkg.name, sources: sources.map((s) => repoPath(pkg, s)), graphTests: full.tests.size, hubs: ranked, chains, graph: g.kind });
  }
  if (a.json) { console.log(JSON.stringify(report, null, 2)); return code; }
  for (const r of report) {
    console.log(`hubs: package ${r.package}: ${r.sources.length} source(s) -> ${r.graphTests} test(s) reached by the ${r.graph} graph`);
    if (!r.hubs.length) console.log('  no intermediate module: every test imports the source directly');
    else {
      console.log('  rank  chains  share  only-via  kept-by-parts  node');
      r.hubs.forEach((h, i) => console.log(`  ${String(i + 1).padStart(4)}  ${String(h.chains).padStart(6)}  ${String(h.share).padStart(4)}%  ${String(h.onlyVia).padStart(8)}  ${String(h.keptByParts).padStart(13)}  ${h.node}`));
      const top = r.hubs.find((h) => h.onlyVia > 0);
      console.log('recommend:');
      console.log('  1. refactor first: make the hub injectable / let each test mount only the modules it uses (a composition root that statically imports every module makes the graph select everything); the graph is then honest and no cut is needed.');
      if (top) console.log(`  2. interim only: "graphCuts": [${JSON.stringify(top.node)}] drops ${top.onlyVia} test(s) that reach the change only through it; \`coverage\` then requires every module behind the cut to be owned by a part. Prove the drop first: mutate --changed --prove-irrelevant <those tests>.`);
      else console.log('  2. no module is the only way to a test: a cut would drop nothing; the breadth is real (shared imports), not a hub.');
    }
    console.log(`chains (shortest import chain per graph-selected test, ${r.chains.length}):`);
    for (const c of r.chains) console.log(`  ${c.chain.join(' -> ')}`);
  }
  return code;
}

/** graphCuts coverage rule: a module whose tests are dropped by the cut must be owned by a part's paths. -> problem lines */
export function cutProblems(H) {
  const cuts = H.cfg.graphCuts;
  const problems = [], warnings = [];
  if (!cuts.length) return { problems, warnings };
  for (const pkg of Object.values(H.cfg.packages)) {
    if (pkg.runner === 'none' || pkg.runner === 'custom') continue;
    const g = buildGraph(H, pkg);
    if (g.error) { warnings.push(`graphCuts: package ${pkg.name} has no graph (${g.error}); cuts are not applied and not enforced there`); continue; }
    const isCut = cutPredicate(H, pkg, g);
    const modules = new Set([...g.edges.keys(), ...g.rev.keys()]);
    for (const m of [...modules].sort()) {
      if (g.tests.has(m) || isCut(m)) continue;
      if (g.kind === 'go' && !g.edges.has(m)) continue;
      const target = [m];
      const full = reaching(g, target).tests;
      if (!full.size) continue;
      const kept = reaching(g, target, isCut).tests;
      const dropped = [...full].filter((t) => !kept.has(t));
      if (!dropped.length) continue;
      const repo = repoPath(pkg, m);
      if (!Object.values(H.cfg.parts).some((p) => H.matchesPaths(repo, p.paths))) problems.push(`${repo}: ${dropped.length} test(s) reach it only through a graphCut (e.g. ${repoPath(pkg, dropped[0])}) and no part's paths own it`);
    }
  }
  return { problems, warnings };
}

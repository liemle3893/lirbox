#!/usr/bin/env node
// Import graph of a JS/TS package from esbuild's metafile (no bundle is written).
//   node esbuild_graph.mjs <package dir> <test file relative to it>...   ->   {"edges": {"<file>": ["<imported file>", ...]}}
//                                                                         or {"error": "<why there is no graph>"}
// Uses the package's own esbuild (devDependency of the project, or the one vite/vitest ships), so tsconfig paths apply.
// Bare package imports stay external; only the project's own modules are nodes. Always exits 0: the caller reads `error`.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const [dirArg, ...tests] = process.argv.slice(2);
const pkgDir = path.resolve(dirArg || '.');
const say = (o) => { console.log(JSON.stringify(o)); process.exit(0); };

let esbuild;
try {
  const require = createRequire(path.join(pkgDir, 'package.json'));
  esbuild = require(require.resolve('esbuild'));
} catch {
  say({ error: `esbuild is not resolvable from ${dirArg}: add it as a devDependency to trace JS/TS import chains` });
}
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-esb-'));
const empty = Object.fromEntries(['.css', '.scss', '.sass', '.less', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.wasm', '.node', '.html', '.md', '.txt', '.sql', '.yaml', '.yml'].map((x) => [x, 'empty']));
let result;
try {
  const r = await esbuild.build({
    entryPoints: tests.map((t) => path.join(pkgDir, t)), absWorkingDir: pkgDir, bundle: true, write: false, metafile: true,
    outdir: out, format: 'esm', platform: 'node', packages: 'external', logLevel: 'silent', loader: empty,
  });
  const edges = {};
  for (const [file, info] of Object.entries(r.metafile.inputs)) {
    if (file.includes(':')) continue;
    edges[file] = [...new Set((info.imports || []).filter((i) => !i.external && !i.path.includes(':')).map((i) => i.path))];
  }
  result = { edges };
} catch (e) {
  const first = e && e.errors && e.errors[0];
  result = { error: `esbuild could not build the graph: ${first ? `${first.text}${first.location ? ` (${first.location.file}:${first.location.line})` : ''}` : String((e && e.message) || e).split('\n')[0]}` };
}
fs.rmSync(out, { recursive: true, force: true });
say(result);

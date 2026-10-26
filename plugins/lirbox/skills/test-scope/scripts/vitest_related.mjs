#!/usr/bin/env node
// Resolves `vitest related` without running a test, per changed source.
//   node vitest_related.mjs <package dir> <source relative to it>...   ->   {"<source>": ["<test file>", ...]}
// Uses the package's own vitest (vitest/node), so the project's config, aliases and setup apply.
// Starts one vitest instance per source (the node API takes `related` as an option); above 40 sources it
// resolves them as one set and attributes the set to the first source, so uncovered detection is per set.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const argv = process.argv.slice(2);
const dry = argv[0] === '--print-args';
const [dirArg, ...rels] = dry ? argv.slice(1) : argv;
const pkgDir = path.resolve(dirArg); // createRequire needs an absolute path
if (dry) { console.log(JSON.stringify({ pkgDir, rels })); process.exit(0); }
process.chdir(pkgDir);
const require = createRequire(path.join(pkgDir, 'package.json'));
const { createVitest } = await import(pathToFileURL(require.resolve('vitest/node')).href);

async function specs(related) {
  const v = await createVitest('test', { watch: false, run: true, related, reporters: [] });
  try {
    const s = await v.getRelevantTestSpecifications();
    return [...new Set(s.map((x) => path.relative(process.cwd(), x.moduleId).split(path.sep).join('/')))].sort();
  } finally { await v.close(); }
}

const out = {};
if (rels.length <= 40) for (const r of rels) out[r] = await specs([r]);
else { const all = await specs(rels); rels.forEach((r, i) => { out[r] = i === 0 ? all : []; }); }
console.log(JSON.stringify(out));
process.exit(0);

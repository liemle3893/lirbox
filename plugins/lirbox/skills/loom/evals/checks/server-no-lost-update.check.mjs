// CHECK — POST /graph must not silently discard a concurrent save. Two valid saves once both
// returned 200 with sequential versions and one edit vanished, the client told it succeeded.
// The wrapper is mandatory: a bare body, or a wrapper with baseVersion omitted, were both
// supported ways to opt out of the check entirely.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');

const root = mkdtempSync(join(tmpdir(), 'loom-eval-'));
mkdirSync(join(root, '.loom', 'state'), { recursive: true });
writeFileSync(join(root, '.loom', 'e.graph.json'),
  readFileSync(join(SCRIPTS, 'seeds', 'delivery.json'), 'utf8'));

const srv = spawn('node', [join(SCRIPTS, 'graph-server.mjs'), '--name', 'e', '--root', root, '--port', '0']);
const port = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('server did not start')), 8000);
  srv.stdout.on('data', (b) => {
    const m = /LOOM_SERVER_PORT=(\d+)/.exec(b.toString());
    if (m) { clearTimeout(t); res(Number(m[1])); }
  });
});
const base = `http://127.0.0.1:${port}`;
const post = (b) => fetch(`${base}/graph`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status);

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };
try {
  const g = await (await fetch(`${base}/graph`)).json();
  const mk = (id) => {
    const c = JSON.parse(JSON.stringify(g));
    c.nodes.push({ id, kind: 'work', prompt: 'x' });
    c.edges.push({ from: 'Implement', to: id, when: { field: 'k', eq: 1 } });
    c.edges.push({ from: id, to: 'Implement', when: 'always' });
    return c;
  };

  ok(await post(mk('Bare')) === 400, 'a bare graph body is refused');
  ok(await post({ graph: mk('NoBase') }) === 400, 'a wrapper without baseVersion is refused');

  const [a, b] = await Promise.all([
    post({ baseVersion: g.version, graph: mk('RaceA') }),
    post({ baseVersion: g.version, graph: mk('RaceB') })]);
  ok([a, b].sort().join(',') === '200,409',
    `exactly one concurrent save wins and the loser is told (got ${a},${b})`);

  // THE SERVER'S RE-VALIDATION IS THE ENFORCEMENT FOR THE BROWSER PATH, AND NOTHING
  // ELSE FREEZES IT. graph-server.mjs says so in a comment ("the editor's lock badges
  // are a courtesy; this is the enforcement") — a comment is not a fence. Measured:
  // deleting validateGraph + the 422 from the server leaves ALL NINE checks green,
  // and a POST of `Implement -> <terminal>` on `always` is then accepted 200 and
  // written to disk, which is the graph scaffold-loom.cjs generates the run from.
  //
  // Read the current version back rather than hardcoding it: the race above always
  // leaves the server at version 1 today, but a hardcoded baseVersion here would make
  // this assertion silently degrade into a second 409 test — passing without ever
  // exercising 422 — the moment anything above it changes what version is current.
  const currentVersion = (await (await fetch(`${base}/graph`)).json()).version;
  const bypass = mk('Bypass');
  bypass.edges.push({ from: 'Implement', to: bypass.terminal, when: 'always' });
  ok(await post({ baseVersion: currentVersion, graph: bypass }) === 422,
    'the server REJECTS a gate-bypassing graph (422), not just a stale one (409)');
  const onDisk = JSON.parse(readFileSync(join(root, '.loom', 'e.graph.json'), 'utf8'));
  ok(!onDisk.edges.some((e) => e.from === 'Implement' && e.to === onDisk.terminal),
    'the rejected bypass edge was NOT written to disk');
} finally { srv.kill(); }

if (bad) { console.error(`\nserver-no-lost-update: ${bad} failed`); process.exit(1); }
console.log('server-no-lost-update: ok');

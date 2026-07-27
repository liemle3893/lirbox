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
} finally { srv.kill(); }

if (bad) { console.error(`\nserver-no-lost-update: ${bad} failed`); process.exit(1); }
console.log('server-no-lost-update: ok');

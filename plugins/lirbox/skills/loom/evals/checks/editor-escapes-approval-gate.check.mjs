// CHECK — every dynamic value in the editor's panel must be escaped before innerHTML.
// Node ids arrive from planner graphPatches (LLM text), and the panel is the page that IS
// the human approval gate, with access to the loopback server. Escaping only `prompt` left
// id and kind raw.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EDITOR = resolve(HERE, '..', '..', 'scripts', 'editor');
const js = readFileSync(join(EDITOR, 'editor.js'), 'utf8');
const html = readFileSync(join(EDITOR, 'index.html'), 'utf8');

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

const panel = js.slice(js.indexOf('function renderPanel'));
const body = panel.slice(0, panel.indexOf('`;') + 2);
const raw = [...body.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim())
  .filter((e) => !/^locked \?/.test(e)).filter((e) => !/^esc\(/.test(e));
ok(raw.length === 0, `no unescaped interpolation reaches innerHTML (found ${JSON.stringify(raw)})`);
ok(/replace\(\/&\/g, '&amp;'\)/.test(js), 'esc escapes & first, avoiding double-encoding');
ok(/from ['"]\.\/graph-core\.mjs['"]/.test(js), 'validateGraph is imported, not reimplemented');
ok(/baseVersion: graph\.version, graph: next/.test(js), 'saves send the concurrency wrapper');

const external = [...html.matchAll(/<(script|link)\b[^>]*>/g)].map((m) => m[0])
  .filter((t) => /https?:\/\//.test(t));
ok(external.length >= 4, 'four external subresources are present');
for (const tag of external) {
  ok(/integrity="sha384-[A-Za-z0-9+/=]+"/.test(tag) && /crossorigin="anonymous"/.test(tag),
    `SRI + crossorigin present on ${tag.slice(0, 48)}...`);
}
ok(!/REPLACE_WITH_SRI/.test(html), 'no SRI placeholder remains');

if (bad) { console.error(`\neditor-escapes-approval-gate: ${bad} failed`); process.exit(1); }
console.log('editor-escapes-approval-gate: ok');

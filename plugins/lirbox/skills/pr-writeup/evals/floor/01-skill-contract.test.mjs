// FLOOR (characterization) — the SKILL.md ↔ filesystem contract holds.
//
// The failure this exists to catch is silent. A skill's SKILL.md tells the reader to open
// `references/components.md` or copy `assets/template.html`; nothing checks that those files are
// still there under those names. Rename or move one and the skill keeps loading, keeps triggering,
// and sends the model at a path that does not exist — with no error anywhere until a human reads
// the output and finds it thin.
//
// The second half is nastier: a `template.html` is only a template while it still has holes in it.
// Commit a FILLED artifact over it — easy, they have the same name and live one directory apart —
// and the skill starts handing every future run someone else's finished page to edit. This asserts
// the shipped templates still look like templates.
//
// Generic on purpose: identical in every skill that ships one, so it cannot rot in one copy.
// Assertions only fire for material the skill actually ships.
//
// Locked (evals/**): an automated fixer may never edit this file.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');
const md = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');

let bad = 0;
const ok = (c, m) => { if (c) console.log(`PASS floor: ${m}`); else { console.error(`FAIL floor: ${m}`); bad++; } };

// 1. Every references/ assets/ scripts/ path SKILL.md names must resolve.
const named = [...new Set([...md.matchAll(/\b((?:references|assets|scripts)\/[A-Za-z0-9._-]+)/g)].map((m) => m[1]))];
ok(named.length > 0, `SKILL.md names at least one shipped file (found ${named.length})`);
for (const rel of named) ok(existsSync(join(SKILL_DIR, rel)), `SKILL.md names ${rel} and it exists`);

// 2. Nothing shipped is empty — an empty asset is a broken instruction that reads as present.
const shipped = [];
for (const sub of ['references', 'assets', 'scripts']) {
  const d = join(SKILL_DIR, sub);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isFile()) shipped.push([`${sub}/${f}`, p]);
  }
}
for (const [rel, p] of shipped) ok(statSync(p).size > 0, `${rel} is not empty`);

// 3. Shell scripts parse — with the interpreter their shebang names, never a blanket `sh`.
//    `sh` is bash on macOS and dash on Linux CI: a bash script with arrays passes `sh -n` on a
//    laptop and fails it in CI, which is how the first version of this floor went red on the
//    one machine that gates the merge. A script is valid in the shell it declares.
const SHELLS = ['bash', 'zsh', 'dash', 'ksh', 'sh'];
for (const [rel, p] of shipped.filter(([r]) => extname(r) === '.sh')) {
  const bang = (readFileSync(p, 'utf8').split('\n')[0].match(/^#!\s*(\S+)(?:\s+(\S+))?/) || []);
  const named = bang[1] ? (bang[1].endsWith('/env') ? bang[2] : bang[1].split('/').pop()) : 'sh';
  const shell = SHELLS.includes(named) ? named : 'sh';
  let parses = true;
  try { execFileSync(shell, ['-n', p], { stdio: 'pipe' }); } catch { parses = false; }
  ok(parses, `${rel} parses (${shell} -n, from its shebang)`);
}

// 4. A shipped template is still a template: it has holes left, and it is still a whole page.
for (const [rel, p] of shipped.filter(([r]) => r === 'assets/template.html')) {
  const t = readFileSync(p, 'utf8');
  const holes = new Set(t.match(/\{\{[^}\n]{1,120}\}\}/g) || []);
  ok(holes.size > 0, `${rel} still carries {{…}} placeholders (${holes.size}) — not a filled artifact`);
  ok(/<html[\s>]/i.test(t), `${rel} is a whole page (<html>)`);
  ok(/<style[\s>]/i.test(t), `${rel} ships its styles (<style>)`);
  ok(/<title[\s>]/i.test(t), `${rel} has a <title>`);
}

// 5. A shipped markdown asset that is a fill-in form keeps its holes.
for (const [rel, p] of shipped.filter(([r]) => r.startsWith('assets/') && extname(r) === '.md')) {
  const t = readFileSync(p, 'utf8');
  if (!/\{\{/.test(t)) continue;
  ok((t.match(/\{\{[^}\n]{1,120}\}\}/g) || []).length > 0, `${rel} still carries {{…}} placeholders`);
}

if (bad) { console.error(`\n01-skill-contract: ${bad} assertion(s) failed`); process.exit(1); }
console.log('01-skill-contract: ok');

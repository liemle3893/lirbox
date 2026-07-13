// Floor: the Bradley-Terry scoring math produces the known dominance ranking on a frozen tally.
// Pins the scoring behavior a kept fix must not break. Throws on failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { bradleyTerry } = require(join(here, '..', '..', 'scripts', 'scaffold-arena.cjs'));

// strong beats mid & weak; mid beats weak → ranking must be strong > mid > weak.
const tallies = [
  { a: 'strong', b: 'mid',  aWins: 8, bWins: 2, ties: 0 },
  { a: 'strong', b: 'weak', aWins: 9, bWins: 1, ties: 0 },
  { a: 'mid',    b: 'weak', aWins: 7, bWins: 3, ties: 0 },
];
const r = bradleyTerry(tallies, ['strong', 'mid', 'weak']);
const order = Object.keys(r).sort((a, b) => r[b] - r[a]);
if (JSON.stringify(order) !== JSON.stringify(['strong', 'mid', 'weak'])) {
  throw new Error(`Elo ranking wrong: got ${JSON.stringify(order)} (ratings ${JSON.stringify(r)})`);
}

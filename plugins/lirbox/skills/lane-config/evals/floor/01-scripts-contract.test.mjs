// Floor: every subcommand SKILL.md tells the agent to run actually exists in the
// script, and the script never invents profiles. A skill that documents a verb
// the script does not implement is a skill that fails at the first step.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const cfg = readFileSync(join(here, '..', '..', 'scripts', 'orch-config.sh'), 'utf8');
const lane = readFileSync(join(root, 'scripts', 'orch-lane.sh'), 'utf8');
const skill = readFileSync(join(here, '..', '..', 'SKILL.md'), 'utf8');

for (const sub of ['detect', 'show', 'init', 'validate', 'set-profile', 'set-lanes', 'set-setup']) {
  if (!new RegExp(`^${sub}\\)`, 'm').test(cfg)) throw new Error(`orch-config.sh: no '${sub}' subcommand`);
  if (!skill.includes(sub)) throw new Error(`SKILL.md: never mentions '${sub}'`);
}

// init must not ship profiles — a guessed profile is the thing this replaces.
const initBlock = cfg.slice(cfg.indexOf('\ninit)'), cfg.indexOf('\nvalidate)'));
if (!/profiles:\s*\{\}/.test(initBlock)) {
  throw new Error('orch-config.sh init: must write an EMPTY profiles object, never invented ones');
}

// Effort is a claude flag. The interactive opencode entry herdr starts has none
// (--variant is `opencode run` only) AND ignores unknown flags without error, so
// emitting one would do nothing while looking like it worked.
if (!/--effort/.test(lane)) throw new Error('orch-lane.sh: must emit --effort for a claude lane');
const emitsVariant = /EFLAG="--variant"|\+=\(--variant/.test(lane);
if (emitsVariant) throw new Error('orch-lane.sh: must NOT emit --variant — the interactive opencode entry ignores it silently');
if (!/claude/.test(cfg) || !/effort is not settable on an opencode lane/.test(cfg)) {
  throw new Error('orch-config.sh: set-profile must refuse effort on a non-claude harness');
}

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

// init must not INVENT what it cannot know. The old assertion here was
// `profiles: {}` — it froze the shape rather than the invariant, and the shape
// was itself the defect: init wrote a config in which profiles, base_branch and
// baseline were all null, so the first `orch-lane.sh start` in every repo died
// three times before a lane ever ran. Making the user decide was implemented as
// failing at them.
//
// What actually has to hold: a model is never guessed. init may declare the
// lirbox roles on a harness it can SEE installed, and must leave the model empty
// for one whose model ids it does not know.
const initBlock = cfg.slice(cfg.indexOf('\ninit)'), cfg.indexOf('\nvalidate)'));
if (!/command -v/.test(initBlock)) {
  throw new Error('orch-config.sh init: must declare profiles from what is INSTALLED, not from a guess');
}
if (/model:\s*\$cap/.test(initBlock) && !/HM_CAP=""/.test(initBlock)) {
  throw new Error('orch-config.sh init: must leave the model empty for a harness whose models it does not know');
}

// The launch flags come from the harness table, never written out here. A
// literal `--agent` in the arg vector is claude/opencode syntax: omp carries its
// profile as `--append-system-prompt <file>`, and a TUI that ignores unknown
// flags would run the whole lane with no invariants while reporting a clean
// start. That failure is invisible for hours.
if (!/hk_launch_args/.test(lane)) {
  throw new Error('orch-lane.sh: must build the launch flags with hk_launch_args, not by hand');
}
if (/-- --agent "\$PROFILE"/.test(lane)) {
  throw new Error('orch-lane.sh: hardcodes `--agent <profile>` — wrong for every harness that carries its context as a file');
}
if (/EFLAG="--variant"|\+=\(--variant/.test(lane)) {
  throw new Error('orch-lane.sh: must NOT emit --variant — the interactive opencode entry ignores it silently');
}

// Effort only rides along on a harness that HAS an effort flag. Asserted
// against the table, not against a sentence: the old check matched the literal
// phrase "effort is not settable on an opencode lane", which passes for a
// script that names opencode and silently emits effort for omp anyway.
if (!/HK_EFFORT_FLAG/.test(cfg)) {
  throw new Error('orch-config.sh: must decide effort-settability from the harness table, not per-harness prose');
}
const table = readFileSync(join(root, 'scripts', 'harness-kinds.sh'), 'utf8');
for (const k of ['claude', 'opencode', 'omp', 'jcode']) {
  if (!new RegExp(`^\\s*${k}\\s`, 'm').test(table)) {
    throw new Error(`harness-kinds.sh: no entry for '${k}'`);
  }
}
if (!/opencode\s+''/.test(table.slice(table.indexOf('HK_EFFORT_FLAG')))) {
  throw new Error("harness-kinds.sh: opencode must declare NO effort flag — its interactive entry ignores unknown flags silently");
}

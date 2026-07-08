#!/usr/bin/env node
/*
 * Val-split CONTAMINATION check for a prospector skill-train run.
 *
 * The held-out guarantee (references/skill-train.md §2.2) is soft: the surface lock stops a propose
 * worker from EDITING the eval set, but not from READING the held-out val split and quietly
 * optimizing toward the judge. The documented mitigation was "check the propose transcripts by
 * hand". This automates that check so it becomes a tripwire in the run report instead of a habit.
 *
 * Runs in the MAIN session (plain Node — fs is fine here; only the loop CONDUCTOR is restricted).
 *
 * THE FALSE-POSITIVE TRAP (why this can't be a grep):
 *   The propose prompt embeds the goal text verbatim, which literally contains
 *   "…run `… --split train` — NEVER run --split val". So EVERY propose worker's transcript mentions
 *   "--split val" as prompt text. Contamination is only when the worker itself EXECUTES a val read —
 *   a Bash `command`, or a Read/Grep of a tasks/val file. So we scan assistant tool_use INPUTS only,
 *   never the prompt/user text (and never heredoc bodies, which are written content, not reads).
 *
 * ATTRIBUTION:
 *   Each workflow worker is one file matching `subagents/workflows/wf_<id>/agent-<id>.jsonl`. Every
 *   worker for a given run embeds the worktree path `.worktrees/opt-<name>` (from inWorktree()),
 *   which keys the files to the run without relying on a time window.
 *
 * Usage:  node check-val-contamination.cjs <name> [--project-dir <dir>] [--json]
 *   exit 0 = clean or not-applicable; exit 2 = contamination found; exit 1 = usage error.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// PURE CORE (testable — no fs): classify a worker transcript and detect EXECUTED val reads.
// ---------------------------------------------------------------------------

// Matches a val-split READ as it appears in an EXECUTED command / file path — `--split val`
// (any `=`/space), or a path under `tasks/val`. Deliberately NOT anchored so it catches
// `timeout 60 node …/run-scored.mjs --split val` and `cat …/tasks/val/20-*.test.mjs` alike.
const VAL_EXEC_RE = /--split[=\s]+val\b|tasks\/val\b/;

// The worker's task prompt is its first `user` entry. We classify role from the prompt ONLY (not
// tool results), keyed on the literal markers scaffold-optimize.cjs writes into each worker prompt.
function firstUserText(entries) {
  for (const o of entries) {
    if (!o || o.type !== 'user') continue;
    const m = o.message || o;
    const c = m && m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c.map((p) => (typeof p === 'string' ? p : (p && typeof p.text === 'string' ? p.text : ''))).join('\n');
    }
  }
  return '';
}

function classifyRole(entries) {
  const t = firstUserText(entries);
  if (/PROPOSE \(experiment/.test(t)) return 'propose';
  if (/EVAL \(experiment/.test(t)) return 'eval';
  if (/BASELINE \(spec/.test(t)) return 'baseline';
  if (/KEEP experiment/.test(t)) return 'keep';
  if (/DISCARD experiment/.test(t)) return 'discard';
  if (/Persist the durable/.test(t)) return 'checkpoint';
  return 'other';
}

// Every assistant tool_use input across the worker (the things it ACTUALLY ran/read).
function toolUseInputs(entries) {
  const out = [];
  for (const o of entries) {
    if (!o || o.type !== 'assistant') continue;
    const m = o.message || o;
    if (!m || !Array.isArray(m.content)) continue;
    for (const c of m.content) {
      if (c && c.type === 'tool_use') out.push({ name: c.name || '?', input: c.input || {} });
    }
  }
  return out;
}

// Remove heredoc BODIES from a shell command — content the command WRITES, not reads. A propose
// worker legitimately writes implementation-notes with `cat >> notes.html <<'EOF' … EOF`, and that
// prose often mentions "tasks/val"; without this, every note-writing worker false-positives.
// Handles <<EOF, <<'EOF', <<"EOF", <<-EOF; non-greedy to the terminator line.
function stripHeredocs(cmd) {
  return String(cmd).replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\2\b/g, ' heredoc-body ');
}

// Shell verbs that READ file CONTENTS (as opposed to enumerating a directory). A val touch via one
// of these leaks the held-out assertions; a touch via ls/wc/find leaks at most filenames.
const CONTENT_VERB = /\b(cat|bat|tac|head|tail|less|more|nl|od|xxd|hexdump|strings|grep|egrep|fgrep|rg|ag|ack|sed|awk|cut|paste|jq|diff|colordiff|view|vim?|nano|emacs)\b|\bgit\s+(show|diff|blame)\b/;
const SPLIT_VAL = /--split[=\s]+val\b/;
const VAL_PATH = /tasks\/val\b/;

// Severity of one val touch (the matched string + the tool that produced it):
//   'high' — read val CONTENTS or ran the val SCORER → invalidates the run's held-out score.
//   'low'  — merely ENUMERATED val (ls/wc/find) → leaks filenames, not answers; noted, not fatal.
// Bash is classified per shell-segment so a benign compound (`cat state.json && ls tasks/val | wc`)
// stays LOW — the content verb (cat) is on a non-val target; only the `ls` segment touches val.
// A `for … in <val-glob>` loop with any content verb is HIGH (it binds a var to val files then reads).
// A mis-tier degrades toward whichever side, but the raw command is always shown so a human can override.
function classifySeverity(matched, tool) {
  if (tool === 'Read' || tool === 'Grep') return 'high'; // these tools read contents by nature
  if (tool === 'Glob' || tool === 'LS') return 'low';    // these only enumerate
  const s = String(matched);
  if (SPLIT_VAL.test(s)) return 'high';                  // ran the val scorer → sees score + per-task pass/fail
  if (/for\s+\w+\s+in\s+[^;]*tasks\/val/.test(s) && CONTENT_VERB.test(s)) return 'high';
  const segments = s.split(/&&|\|\||;|\|/);
  if (segments.some((seg) => CONTENT_VERB.test(seg) && VAL_PATH.test(seg))) return 'high';
  return 'low';                                          // val path present but only via enumeration/bare ref
}

// A val touch the worker EXECUTED: scan the string-valued fields a tool actually acts on
// (Bash.command, Read/Edit.file_path, Grep/Glob.path+pattern). NOT arbitrary prose fields, and NOT
// heredoc bodies. Each hit carries a severity — a human still verifies, but HIGH goes first.
function valExecHits(entries) {
  const hits = [];
  for (const { name, input } of toolUseInputs(entries)) {
    const acted = [
      typeof input.command === 'string' ? stripHeredocs(input.command) : null,
      input.file_path, input.path, input.pattern,
    ].filter((s) => typeof s === 'string');
    const hit = acted.find((s) => VAL_EXEC_RE.test(s));
    if (hit) hits.push({ tool: name, severity: classifySeverity(hit, name), detail: hit.replace(/\s+/g, ' ').trim().slice(0, 180) });
  }
  return hits;
}

// One worker → { role, hits }. Contaminated iff role === 'propose' AND it executed a val read.
function analyzeWorker(entries) {
  const role = classifyRole(entries);
  const hits = role === 'propose' ? valExecHits(entries) : [];
  return { role, hits };
}

// ---------------------------------------------------------------------------
// FS discovery + orchestration (impure).
// ---------------------------------------------------------------------------

function parseLines(txt) {
  const out = [];
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return out;
}

// Every `subagents/workflows/wf_<id>/agent-<id>.jsonl` under projDir whose text embeds this run's
// worktree marker. Returns [{ file, entries }]. Reads each candidate file once.
function findRunAgentFiles(projDir, name) {
  const marker = `.worktrees/opt-${name}`;
  const out = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'memory') walk(p); continue; }
      if (!e.isFile() || !/^agent-.*\.jsonl$/.test(e.name)) continue;
      if (!/subagents[/\\]workflows[/\\]wf_/.test(p)) continue;
      let txt = '';
      try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
      if (!txt.includes(marker)) continue;
      out.push({ file: p, entries: parseLines(txt) });
    }
  })(projDir);
  return out;
}

// Full scan for a run → summary object. `applicable` is false when this run's metric is not a
// val-split metric (a code-optimization run, not skill-train) — the caller then emits nothing.
function scanRun(projDir, name, metricCmd) {
  const applicable = typeof metricCmd === 'string' && VAL_EXEC_RE.test(metricCmd);
  const files = findRunAgentFiles(projDir, name);
  let proposeWorkers = 0;
  const high = []; // workers that read val CONTENTS or ran the val SCORER — invalidating
  const low = [];  // workers that only ENUMERATED val (filenames) — noted, not invalidating
  for (const { file, entries } of files) {
    const { role, hits } = analyzeWorker(entries);
    if (role !== 'propose') continue;
    proposeWorkers++;
    if (!hits.length) continue;
    (hits.some((h) => h.severity === 'high') ? high : low).push({ file, hits });
  }
  return { applicable, agentFilesForRun: files.length, proposeWorkers, high, low };
}

// Render one worker's flagged hits (HIGH first within the worker).
function renderWorker(c) {
  let md = `- \`${c.file}\`\n`;
  const ordered = c.hits.slice().sort((a, b) => (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1));
  for (const h of ordered) md += `    - [${h.severity.toUpperCase()}] ${h.tool}: \`${h.detail}\`\n`;
  return md;
}

// Markdown section for the run report (empty string when not applicable). Three states:
// HIGH present → contaminated (score not trustworthy); LOW only → noted (filenames, not fatal);
// none → clean.
function contaminationSection(result, name) {
  if (!result.applicable) return '';
  let md = `\n## Held-out val-split audit\n\n`;
  if (result.agentFilesForRun === 0) {
    md += `> ⚠️ Could not find any workflow worker transcripts for \`opt/${name}\` under the project dir — `;
    md += `val access is UNAUDITED. (Were the workers run in a different project dir? Pass \`--project-dir\`.)\n`;
    return md;
  }
  if (result.proposeWorkers === 0) {
    md += `> ⚠️ Found run transcripts but no PROPOSE workers — val access is UNAUDITED (unexpected for a skill-train run).\n`;
    return md;
  }
  if (result.high.length) {
    md += `> ⚠️ **CONTAMINATION — the val score is not trustworthy.** ${result.high.length} of ${result.proposeWorkers} `;
    md += `propose worker(s) read the held-out val split's CONTENTS or ran the val SCORER. A propose worker must only ever `;
    md += `see \`--split train\`; this lets the loop optimize toward the judge, so baseline→best is NOT a clean held-out gain. `;
    md += `Verify these before trusting the run:\n\n`;
    for (const c of result.high) md += renderWorker(c);
    if (result.low.length) {
      md += `\nAlso ${result.low.length} worker(s) only enumerated val (filenames) — see below.\n`;
    }
  }
  if (result.low.length) {
    md += result.high.length ? `\n` : ``;
    md += `> ${result.high.length ? '' : 'ⓘ '}${result.low.length} of ${result.proposeWorkers} propose worker(s) `;
    md += `ENUMERATED the val dir (filenames/counts only — no contents or score read). Filenames can leak topic hints; `;
    md += `low risk and NOT treated as invalidating, but verify if the run looks unusually good:\n\n`;
    for (const c of result.low) md += renderWorker(c);
    return md;
  }
  if (!result.high.length) {
    md += `✓ ${result.proposeWorkers} propose worker(s) audited — none read the held-out val split's contents or ran its scorer. `;
    md += `Score is trustworthy on this axis.\n`;
  }
  return md;
}

module.exports = {
  VAL_EXEC_RE, stripHeredocs, classifySeverity, firstUserText, classifyRole, toolUseInputs,
  valExecHits, analyzeWorker, findRunAgentFiles, scanRun, contaminationSection,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (require.main === module) {
  const name = process.argv[2];
  if (!name || name.startsWith('--')) {
    console.error('usage: check-val-contamination.cjs <name> [--project-dir <dir>] [--json]');
    process.exit(1);
  }
  const di = process.argv.indexOf('--project-dir');
  const projDir = di > -1 ? process.argv[di + 1]
    : path.join(os.homedir(), '.claude', 'projects', process.cwd().replace(/\//g, '-'));

  // Read the run's metric.cmd so a non-val run reports not-applicable rather than a false all-clear.
  let metricCmd = null;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join('.optimize', 'config', name + '.json'), 'utf8'));
    metricCmd = cfg && cfg.metric && cfg.metric.cmd;
  } catch { /* no config → treat as applicable so an orphaned run is still audited */ metricCmd = '--split val'; }

  const result = scanRun(projDir, name, metricCmd);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(result, null, 2)); }
  else {
    const md = contaminationSection(result, name);
    console.log(md || `(val-split audit not applicable — metric is not a --split val metric)`);
  }
  // exit 2 only for HIGH (invalidating) contamination; LOW enumeration is noted, not a blocker.
  process.exit(result.applicable && result.high.length ? 2 : 0);
}

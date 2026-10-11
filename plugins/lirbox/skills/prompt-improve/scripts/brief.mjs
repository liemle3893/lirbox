#!/usr/bin/env node
// Prompt Improver CLI for the prompt-improve skill. Free commands only: no Opus, no Anthropic key.
// engine.mjs and catalog.mjs are copies of daily-news src/lib/brief/ (the /tools/prompt-improver page); keep them in sync.
//   node brief.mjs list [--json]                                  templates: id, group, name, kind
//   node brief.mjs template <id>                                  parts, hints, checks, rubric, snippets, example
//   node brief.mjs suggest --json "<request>"                     local keyword match + Jev's ranked pick (local only without Jev)
//   node brief.mjs judge --template <id> [--on a,b] [--json] < prompt.txt                      Jev grades it (exit 3: Jev not set up)
//   node brief.mjs questions --template <id> [--on a,b] < prompt.txt                           Jev's exact state + questions, for the Haiku fallback
//   node brief.mjs judge --template <id> [--on a,b] --answers answers.json [--json] < prompt.txt   grade from the fallback's answers
//   node brief.mjs assemble --template <id> [--model opus|sonnet] [--effort e] [--unattended] [--strict] [--json] < parts.json
// Jev env: TYPESAFE_API_KEY (+ TYPESAFE_BASE_URL), see plugins/lirbox/scripts/jev.mjs.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { askJev, apiToken } from "../../../scripts/jev.mjs";
import {
  partsFor, assemble, jevJudgeQuestions, jevJudgeState, jevTemplateQuestions, readJudgeAnswers, scorecard, suggestLocal,
} from "./engine.mjs";
import { PARTS, PART, PART_IDS, RUBRIC, TEMPLATE, TEMPLATES, MODELS, EFFORTS, SNIPPET_LIBRARY, GROUPS } from "./catalog.mjs";

export const NO_JEV_EXIT = 3;
const need = (ok, msg) => { if (!ok) throw new Error(msg); };
const cleanOn = (on, tplId) => { const xs = (Array.isArray(on) && on.length ? on : partsFor(tplId)).filter((id) => PART_IDS.includes(id)); return PART_IDS.filter((id) => xs.includes(id)); };
const cleanText = (text) => {
  text = String(text ?? "").trim();
  need(text.length >= 15, "Write a little more first: the brief is under 15 characters.");
  need(text.length <= 40_000, "The brief is over 40,000 characters.");
  return text;
};

// answers: one Jev-shaped answers object per run. by: who answered (jev | haiku), reported so a fallback grade is never read as Jev's.
export function grade({ answers, on, by }) {
  const runs = answers.map((a) => readJudgeAnswers(a, on));
  return { ...scorecard(runs, on), on, by };
}

export async function judgeWithJev({ text, tplId, on, runs = 3 }) {
  const state = jevJudgeState(text, tplId), questions = jevJudgeQuestions(on);
  const settled = await Promise.allSettled(Array.from({ length: runs }, () => askJev({ state, questions })));
  const ok = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) throw new Error(`Jev failed: ${settled[0].reason?.message ?? "no answer"}`);
  const cost = ok.reduce((s, r) => s + (r.usage?.cost ?? 0), 0);
  return { ...grade({ answers: ok.map((r) => r.answers), on, by: "jev" }), failedRuns: runs - ok.length, cost: +cost.toFixed(5) };
}

export async function suggest(request) {
  request = String(request ?? "").trim().slice(0, 4000);
  const local = suggestLocal(request, 5);
  if (!apiToken() || request.length < 8) return { local, jev: null };
  let r;
  try { r = await askJev({ state: { request }, questions: jevTemplateQuestions() }); } catch { return { local, jev: null }; }
  const a = r.answers?.template;
  if (a?.type !== "choice") return { local, jev: null };
  const probs = Array.isArray(a.probabilities) ? Object.fromEntries(a.probabilities.map((x) => [x.choice ?? x.label, x.probability ?? x.p]))
    : a.probabilities && typeof a.probabilities === "object" ? a.probabilities : { [a.choice]: a.confidence ?? 1 };
  const jev = Object.entries(probs).filter(([id, p]) => TEMPLATE[id] && Number.isFinite(+p)).map(([id, p]) => ({ id, p: +(+p).toFixed(3) }))
    .filter((x) => x.p >= 0.01).sort((x, y) => y.p - x.p).slice(0, 5);
  if (!jev.length && TEMPLATE[a.choice]) jev.push({ id: a.choice, p: +(a.confidence ?? 1) });
  return { local, jev };
}

export function templateInfo(id) {
  const t = TEMPLATE[id];
  need(t, `Unknown template "${id}". Run: brief.mjs list`);
  const on = partsFor(id);
  return {
    id, name: t.name, kind: t.kind, group: t.group, flags: { unattended: !!t.unattended, planOnly: !!t.planOnly, research: !!t.research, multiApp: !!t.multiApp, code: t.code !== false },
    parts: on.map((pid) => ({ id: pid, name: PART[pid].name, weight: PART[pid].w, ask: PART[pid].ask, hint: t.hints[pid],
      good: RUBRIC[pid][3], best: RUBRIC[pid][4], snippets: [...(pid === "verify" ? t.checks : []), ...(SNIPPET_LIBRARY[pid] ?? [])] })),
    optional: PARTS.filter((p) => !on.includes(p.id)).map((p) => ({ id: p.id, name: p.name, when: p.when ?? null, ask: p.ask })),
    notes: t.notes ?? [], example: t.example,
  };
}

const cardJson = (c) => ({ by: c.by, total: c.total, verdict: c.verdict, clarity: c.clarity, over: c.over, warnings: c.warnings.map((w) => w.text),
  parts: Object.fromEntries(c.on.map((id) => [id, { score: c.parts[id].score, spread: c.parts[id].spread, target: c.parts[id].target }])),
  ...(c.cost != null ? { cost: c.cost } : {}) });
const fmt = (c) => `${c.by}: ${c.verdict.toUpperCase()} ${c.total}  ${c.on.map((id) => `${id}=${c.parts[id].score}`).join(" ")}  over=${c.over} clarity=${c.clarity}${c.warnings.length ? `\n  ⚠ ${c.warnings.map((w) => w.text).join("\n  ⚠ ")}` : ""}`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const VALUE = new Set(["--template", "--runs", "--effort", "--model", "--on", "--answers"]);
  const flags = {}, args = [];
  for (let i = 0; i < rest.length; i++) { const a = rest[i]; if (VALUE.has(a)) flags[a] = rest[++i]; else if (a.startsWith("--")) flags[a] = true; else args.push(a); }
  const json = !!flags["--json"];
  const print = (x) => console.log(JSON.stringify(x, null, 1));
  const stdin = () => fs.readFileSync(0, "utf8");
  const tplId = flags["--template"] ?? "feature";
  const on = () => { need(TEMPLATE[tplId], `Unknown template "${tplId}".`); return cleanOn(flags["--on"]?.split(",").map((x) => x.trim()), tplId); };

  if (cmd === "list") {
    const rows = TEMPLATES.map((t) => ({ id: t.id, group: t.group, name: t.name, kind: t.kind }));
    if (json) print(rows); else for (const g of GROUPS) console.log(`${g.name}:\n${rows.filter((r) => r.group === g.id).map((r) => `  ${r.id.padEnd(10)} ${r.name}: ${r.kind}`).join("\n")}`);
  } else if (cmd === "template") {
    print(templateInfo(args[0] ?? tplId));
  } else if (cmd === "assemble") {
    const input = JSON.parse(stdin() || "{}");
    const model = flags["--model"] ?? "opus", effort = flags["--effort"] ?? "";
    need(MODELS[model], "--model must be opus or sonnet."); need(!effort || EFFORTS.includes(effort), `--effort must be one of ${EFFORTS.join(", ")}.`);
    need(TEMPLATE[tplId], `Unknown template "${tplId}".`);
    const pasted = (input.pasted ?? []).map((b) => ({ ...b, id: b.id ?? Math.random().toString(36).slice(2, 6) }));
    const a = assemble({ tplId, parts: input.parts ?? {}, on: input.on ?? on(), model, effort, pasted, opts: { unattended: !!flags["--unattended"], strictScope: !!flags["--strict"] } });
    if (json) print({ text: a.text, guards: a.guards.map((g) => ({ at: g.at, src: g.src })), notes: a.notes }); else console.log(a.text);
  } else if (cmd === "suggest") {
    const r = await suggest(args.join(" ") || stdin());
    if (json) return print(r);
    console.log("local:", r.local.map((x) => `${x.id}(${x.hits.join("/")})`).join(", ") || "none");
    console.log("jev:  ", r.jev?.map((x) => `${x.id} ${(x.p * 100).toFixed(0)}%`).join(", ") ?? "unavailable");
  } else if (cmd === "questions") {
    const ids = on();
    print({ state: jevJudgeState(cleanText(stdin()), tplId), questions: jevJudgeQuestions(ids), on: ids });
  } else if (cmd === "judge") {
    const ids = on(), text = cleanText(stdin());
    let card;
    if (flags["--answers"]) {
      const raw = JSON.parse(fs.readFileSync(flags["--answers"], "utf8"));
      card = grade({ answers: (Array.isArray(raw) ? raw : [raw]).map((a) => a.answers ?? a), on: ids, by: "haiku" });
    } else {
      if (!apiToken()) { console.error("Jev is not set up (TYPESAFE_API_KEY missing). Use the Haiku fallback: brief.mjs questions, then judge --answers."); process.exit(NO_JEV_EXIT); }
      card = await judgeWithJev({ text, tplId, on: ids, runs: Math.min(5, Math.max(1, +(flags["--runs"] ?? 3) | 0)) });
    }
    if (json) print(cardJson(card)); else console.log(fmt(card));
  } else {
    console.log("usage: brief.mjs list | template <id> | suggest [--json] <request> | questions --template <id> [--on a,b] < prompt | judge --template <id> [--on a,b] [--answers file] [--json] < prompt | assemble --template <id> [--model opus|sonnet] [--effort e] [--unattended] [--strict] [--json] < parts.json");
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main().catch((e) => { console.error(e.message); process.exit(1); });

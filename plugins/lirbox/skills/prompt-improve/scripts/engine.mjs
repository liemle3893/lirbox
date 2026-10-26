// Prompt Improver engine: pure functions over the catalog, shared by the page, the dev-server API and the tests.
// No I/O here; scripts/brief-api.mjs does the Jev and Claude calls.
import { PARTS, PART, PART_IDS, RUBRIC, OVER_RUBRIC, MODELS, SNIPPETS, GUARDS, NOTES, TEMPLATES, TEMPLATE } from "./catalog.mjs";

export const THRESHOLDS = { ready: 75, tune: 50, clarity: 0.3, over: 1.5, unstable: 1.5 };

export const effectiveEffort = (model, effort) => effort || MODELS[model]?.def || "medium";
export const coreParts = () => PARTS.filter((p) => p.group === "core").map((p) => p.id);

// The parts a template switches on, always including the core ones, in prompt order.
export function partsFor(tplId) {
  const t = TEMPLATE[tplId];
  const on = new Set([...coreParts(), ...(t?.on ?? [])]);
  return PART_IDS.filter((id) => on.has(id));
}

// Short random id for <pasted_content id="…"> (the guide wants the same random id on the opening and closing tag).
export const pasteId = () => Math.random().toString(36).slice(2, 6);

// Guard lines and owner notes for a setup. s.on may be an array or a Set.
export function guardsFor({ tplId, model = "opus", effort = "", on = [], pasted = [], opts = {} }) {
  const tpl = TEMPLATE[tplId] ?? {};
  const s = { model, eff: effectiveEffort(model, effort), on: new Set(on), tpl, opts, pasted: pasted.filter((b) => b.text?.trim()).length };
  const guards = GUARDS.filter((g) => g.when(s)).map((g) => ({ id: g.id, at: g.at, text: SNIPPETS[g.snip].text, src: SNIPPETS[g.snip].src }));
  const notes = NOTES.filter((n) => n.when(s)).map(({ id, text, src }) => ({ id, text, src }));
  return { guards, notes };
}

// The brief as sections (for the annotated sheet) and as the text to copy. Empty parts are left out of the text;
// a part that is off but carries a guard still prints the guard.
export function assemble({ tplId, parts = {}, on = partsFor(tplId), model = "opus", effort = "", pasted = [], opts = {} }) {
  const onSet = new Set(on);
  const { guards, notes } = guardsFor({ tplId, model, effort, on: [...onSet], pasted, opts });
  const blocks = pasted.filter((b) => b.text?.trim());
  const sections = [];
  for (const p of PARTS) {
    const mine = guards.filter((g) => g.at === p.id);
    const active = onSet.has(p.id);
    if (!active && !mine.length) continue;
    const text = active ? (parts[p.id] ?? "").trim() : "";
    const paste = active && p.id === "inputs" ? blocks : [];
    sections.push({ id: p.id, name: p.name, active, text, pasted: paste, guards: mine });
  }
  const out = sections.map((s) => {
    const chunks = [];
    if (s.text) chunks.push(s.text);
    for (const b of s.pasted) chunks.push(`${b.source ? `From ${b.source}:\n` : ""}<pasted_content id="${b.id}">\n${b.text.trim()}\n</pasted_content id="${b.id}">`);
    for (const g of s.guards) chunks.push(g.text);
    return chunks.join("\n\n");
  }).filter(Boolean);
  return { sections, guards, notes, text: out.join("\n\n") };
}

// ── Questions the owner still has to answer: [?: who plays it?] ──
const Q = /\[\?:\s*([^\]]*?)\s*\]/g;
export const questionsIn = (text = "") => [...String(text).matchAll(Q)].map((m) => m[1]);
// Replace the n-th question slot in text with the answer.
export function answerQuestion(text, n, answer) {
  let i = -1;
  return String(text).replace(Q, (m) => (++i === n ? answer : m));
}

// ── Jev ──
export function jevJudgeQuestions(on) {
  const q = {};
  for (const id of on) q[`part_${id}`] = { type: "score", instructions: `How well does \`brief\` cover ${PART[id].q}?`, criteria: RUBRIC[id] };
  q.over_direction = { type: "score", instructions: "Does `brief` leave implementation choices to Claude instead of scripting them step by step?", criteria: OVER_RUBRIC };
  q.clarity = { type: "noul", instructions: "A capable developer with no other context could start the work described in `brief` from it alone." };
  return q;
}
export function jevJudgeState(text, tplId) {
  const t = TEMPLATE[tplId];
  return { brief: text, task: t ? `${t.name}: ${t.kind}` : "A software task" };
}
export function jevTemplateQuestions() {
  return { template: { type: "choice", instructions: "Which kind of task best describes `request`?",
    criteria: Object.fromEntries(TEMPLATES.map((t) => [t.id, `${t.name}: ${t.kind}`])) } };
}

export const median = (xs) => { const s = [...xs].filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return NaN; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// One Jev response → { parts: {id: score}, over, clarity }. Throws on a missing answer.
export function readJudgeAnswers(answers, on) {
  const read = (k, type) => { const a = answers?.[k]; if (a?.type !== type) throw new Error(`Jev gave no ${type} answer for ${k}`); return a; };
  return {
    parts: Object.fromEntries(on.map((id) => [id, read(`part_${id}`, "score").score])),
    over: read("over_direction", "score").score,
    clarity: read("clarity", "noul").noul,
  };
}

export function partState(score) {
  const l = Math.round(score);
  return l >= 3 ? "good" : l === 2 ? "weak" : "missing";
}
export function weightedTotal(scores, on) {
  let num = 0, den = 0;
  for (const id of on) { if (!Number.isFinite(scores[id])) continue; const w = PART[id].w; num += (Math.min(4, Math.max(0, scores[id])) / 4) * 100 * w; den += w; }
  return den ? Math.round(num / den) : 0;
}
export function verdictOf(total, clarity) {
  if (Number.isFinite(clarity) && clarity < THRESHOLDS.clarity) return "unclear";
  return total >= THRESHOLDS.ready ? "ready" : total >= THRESHOLDS.tune ? "tune" : "rewrite";
}
export const VERDICTS = {
  ready: { label: "Ready", v: "SHIP", say: "Send it." },
  tune: { label: "Tune", v: "FIX", say: "Worth fixing the weak parts first." },
  rewrite: { label: "Rewrite", v: "KILL", say: "Claude would have to guess too much." },
  unclear: { label: "Unclear", v: "KILL", say: "A colleague couldn't start from this." },
};

// Several Jev runs → the scorecard (medians, spread per part, verdict, warnings).
export function scorecard(runs, on) {
  const parts = {};
  for (const id of on) {
    const xs = runs.map((r) => r.parts[id]);
    const score = median(xs);
    const level = Math.round(score);
    parts[id] = { score: +score.toFixed(2), spread: +(Math.max(...xs) - Math.min(...xs)).toFixed(2), level, state: partState(score),
      now: RUBRIC[id][Math.min(4, Math.max(0, level))], target: level < 3 ? RUBRIC[id][3] : level < 4 ? RUBRIC[id][4] : null };
  }
  const scores = Object.fromEntries(on.map((id) => [id, parts[id].score]));
  const over = median(runs.map((r) => r.over)), clarity = median(runs.map((r) => r.clarity));
  const total = weightedTotal(scores, on);
  const verdict = verdictOf(total, clarity);
  const warnings = [];
  if (over <= THRESHOLDS.over) warnings.push({ id: "over", text: "Over-specified: it scripts steps Claude could decide. Keep the goal and the checks, and cut the steps." });
  if (clarity < THRESHOLDS.clarity) warnings.push({ id: "clarity", text: "A developer with no context couldn't start from this alone. Answer any open [?] questions, or say more plainly what's being built." });
  const shaky = on.filter((id) => parts[id].spread >= THRESHOLDS.unstable);
  if (shaky.length) warnings.push({ id: "unstable", text: `Jev's runs disagreed on ${shaky.map((id) => PART[id].name).join(", ")}; treat those marks as rough.` });
  return { total, verdict, parts, over: +over.toFixed(2), clarity: +clarity.toFixed(2), warnings, runs: runs.length };
}
// Parts Opus may rewrite: below Good, or empty.
export const weakParts = (card, on, parts = {}) => on.filter((id) => !(parts[id] ?? "").trim() || (card?.parts?.[id] && card.parts[id].level < 3));

// ── Local template suggestion (instant, free): keyword phrases in the request. Multi-word phrases count double. ──
const norm = (s) => ` ${String(s).toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, " ").trim()} `;
export function suggestLocal(request, n = 3) {
  const text = norm(request);
  if (text.trim().length < 3) return [];
  return TEMPLATES.map((t) => {
    const hits = t.keywords.filter((k) => text.includes(norm(k)));
    const score = hits.reduce((s, k) => s + (k.includes(" ") ? 2 : 1), 0);
    return { id: t.id, score, hits };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score || TEMPLATES.findIndex((t) => t.id === a.id) - TEMPLATES.findIndex((t) => t.id === b.id)).slice(0, n);
}

// ── Opus output checks ──
// draft / improve: keep only parts Opus was allowed to write, with their question slots listed.
export function acceptRewrites(parts, allowed) {
  const ok = new Set(allowed), seen = new Set();
  return (parts ?? []).filter((p) => ok.has(p.id) && typeof p.text === "string" && p.text.trim() && !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ id: p.id, text: p.text.trim(), why: String(p.why ?? "").trim(), questions: questionsIn(p.text) }));
}
// split: every span must be copied from the original prompt (whitespace aside); anything else is dropped and counted.
const squash = (s) => String(s).replace(/\s+/g, " ").trim();
export function acceptSplit(parts, original, allowed = PART_IDS) {
  const hay = squash(original), ok = new Set(allowed), out = {};
  let dropped = 0;
  for (const p of parts ?? []) {
    if (!ok.has(p.id)) { dropped += (p.spans ?? []).length; continue; }
    for (const span of p.spans ?? []) {
      const s = squash(span);
      if (!s || !hay.includes(s)) { dropped++; continue; }
      out[p.id] = out[p.id] ? `${out[p.id]}\n${span.trim()}` : span.trim();
    }
  }
  return { parts: out, dropped };
}

export { PARTS, PART, PART_IDS, RUBRIC, MODELS, TEMPLATES, TEMPLATE };

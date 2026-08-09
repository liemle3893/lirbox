#!/usr/bin/env node
/*
 * What will this graph COST in wall-clock, before a single agent is spawned?
 *
 *   node graph-metrics.mjs .loom/<name>.graph.json
 *
 * loom's wall-clock is its CRITICAL PATH — the longest chain of workers that must run in
 * sequence — not its node count. A fork region runs its nodes concurrently, so eight nodes behind
 * one fork finish in the time of the longest chain through them, while eight nodes in a line take
 * eight times as long.
 *
 * Measured against the emitted conductor with a fixed slice of simulated work per node,
 * `criticalPath() * slice` predicted real wall-clock to within 1-3% across linear and forked
 * graphs of 2-8 nodes. That is why this is worth printing: it is not a heuristic score, it is the
 * run's duration in units of node-time.
 *
 * Reads a graph file. Never executes anything and never touches run state, so it is safe to run on
 * a graph that is currently being edited.
 */
import { readFileSync } from 'node:fs';
import { criticalPath, parallelism, regionNodes } from './graph-core.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: graph-metrics.mjs <graph.json>');
  process.exit(2);
}

let graph;
try {
  graph = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(2);
}

const workers = (graph.nodes || []).filter(
  (n) => n.kind !== 'terminal' && n.kind !== 'fork');
const cp = criticalPath(graph);
const par = parallelism(graph);
const forks = (graph.nodes || []).filter((n) => n.kind === 'fork');

console.log(`graph:          ${graph.name || file}`);
console.log(`workers:        ${workers.length}`);
console.log(`critical path:  ${cp}   <- the run takes this many node-times`);
console.log(`parallelism:    ${par.toFixed(2)}x`);
console.log(`fork regions:   ${forks.length}`
  + (forks.length ? ` (${forks.map((f) => `${f.id} -> ${f.join}`).join(', ')})` : ''));

const max = graph.invariants && graph.invariants.maxCriticalPath;
if (max) {
  console.log(`maxCriticalPath: ${max}  ${cp > max ? '*** EXCEEDED ***' : 'ok'}`);
}

console.log('');
if (par < 1.05 && workers.length > 3) {
  // Not an error. Plenty of work is genuinely sequential — an implementation cannot start before
  // the plan, and a gate cannot adjudicate work that has not happened. This says what the number
  // MEANS so the reader can decide whether the sequence is real.
  console.log(`Every worker waits for the one before it: ${workers.length} workers, ${cp}`);
  console.log('node-times. This graph is a sequence wearing a graph\'s clothes, and running it');
  console.log('through loom buys gates and resumability but no wall-clock over one session.');
  console.log('');
  console.log('If any of those nodes are independent, a fork region over them cuts the run to');
  console.log('the length of its longest branch. If they genuinely depend on each other, this');
  console.log('is the correct shape and the number is just the honest price.');
} else if (forks.length) {
  const saved = workers.length - cp;
  console.log(`${forks.length} fork region(s) overlap ${saved} node-time(s) of work: this runs in`);
  console.log(`${cp} node-times instead of ${workers.length}.`);
}

#!/usr/bin/env node
/*
 * loom's pre-flight + live-view server.
 *
 *   node graph-server.mjs --name <name> --root <repoRoot> [--port 0]
 *
 * Binds 127.0.0.1 ONLY. It has no authentication because it is never reachable off
 * the loopback interface; do not change the bind address to add convenience.
 *
 * It cannot spawn agents — agents exist only inside the Claude session. "Replan" and
 * "approve" are therefore a handoff: this server writes <name>.action.json and the
 * skill, polling in the main session, picks it up.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGraph } from './graph-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv;
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
};

const NAME = arg('name', '');
const ROOT = arg('root', process.cwd());
const PORT = Number(arg('port', 0));
if (!NAME || NAME === true) { console.error('ERROR: --name is required'); process.exit(1); }

const graphPath = path.join(ROOT, '.loom', `${NAME}.graph.json`);
const statePath = path.join(ROOT, '.loom', 'state', `${NAME}.json`);
const actionPath = path.join(ROOT, '.loom', `${NAME}.action.json`);

const readJson = (p, dflt) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; }
};
const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};
// Reject an oversized body with a real 413 the client can read. Destroying the socket
// immediately (as an earlier version did) tears it down before any response can be
// written, so the caller sees a bare ECONNRESET instead of the error the code intended
// to send. Stop accumulating, answer, THEN destroy.
const readBody = (req, res) => new Promise((resolve, reject) => {
  let d = '';
  let over = false;
  req.on('data', (c) => {
    if (over) return;
    d += c;
    if (d.length > 4e6) {
      over = true;
      send(res, 413, { error: 'body too large', limit: 4e6 });
      req.destroy();
      reject(new Error('body too large'));
    }
  });
  req.on('end', () => {
    if (over) return;
    try { resolve(JSON.parse(d || '{}')); } catch (e) { reject(e); }
  });
});

// Static assets are limited to the editor directory and resolved through a prefix
// check, so a crafted path cannot escape into the rest of the repo.
function serveStatic(res, rel) {
  const dir = path.join(HERE, 'editor');
  const file = path.resolve(dir, '.' + rel);
  if (!file.startsWith(dir + path.sep) && file !== path.join(dir, 'index.html')) {
    return send(res, 403, { error: 'forbidden' });
  }
  if (!fs.existsSync(file)) return send(res, 404, { error: 'not found' });
  const type = file.endsWith('.html') ? 'text/html; charset=utf-8'
    : file.endsWith('.mjs') || file.endsWith('.js') ? 'text/javascript; charset=utf-8'
    : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return serveStatic(res, '/index.html');
    }
    if (req.method === 'GET' && p === '/editor.js') return serveStatic(res, '/editor.js');
    // The editor imports the SAME validator the conductor inlines.
    if (req.method === 'GET' && p === '/graph-core.mjs') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return fs.createReadStream(path.join(HERE, 'graph-core.mjs')).pipe(res);
    }
    if (req.method === 'GET' && p === '/graph') {
      return send(res, 200, readJson(graphPath, { error: 'no graph yet' }));
    }
    if (req.method === 'GET' && p === '/state') {
      return send(res, 200, readJson(statePath, { status: 'not started' }));
    }
    if (req.method === 'POST' && p === '/graph') {
      const body = await readBody(req, res);
      const prev = readJson(graphPath, null);
      const prevVersion = (prev && prev.version) || 0;

      // OPTIMISTIC CONCURRENCY. Without this, two concurrent valid saves both return
      // 200 with sequential versions and one edit is silently discarded — the client
      // is told it succeeded while its work is gone. Measured: two Promise.all posts
      // adding different nodes both got 200, and only the later node survived.
      // The client must declare which version it edited from; a stale base is 409.
      // `baseVersion` travels alongside the graph rather than inside it, so it can
      // never be confused with the server-owned `version` field.
      const { baseVersion, graph: next } = (body && body.graph)
        ? body
        : { baseVersion: undefined, graph: body };   // legacy shape: graph posted bare
      if (baseVersion !== undefined && baseVersion !== prevVersion) {
        return send(res, 409, {
          error: 'stale base version',
          yourBaseVersion: baseVersion,
          currentVersion: prevVersion,
          hint: 'GET /graph, re-apply your edit on the current graph, and POST again',
        });
      }

      // Re-validate server-side ALWAYS. The editor's lock badges are a courtesy;
      // this is the enforcement.
      const violations = validateGraph(next, prev, null);
      if (violations.length) return send(res, 422, { violations });

      // The server owns `version` — a client-submitted value is always ignored.
      next.version = prevVersion + 1;
      fs.writeFileSync(graphPath, JSON.stringify(next, null, 2) + '\n');
      return send(res, 200, { ok: true, version: next.version });
    }
    if (req.method === 'POST' && p === '/action') {
      const body = await readBody(req, res);
      if (body.action !== 'replan' && body.action !== 'approve') {
        return send(res, 400, { error: 'action must be "replan" or "approve"' });
      }
      fs.writeFileSync(actionPath, JSON.stringify({
        action: body.action, comments: body.comments || [],
      }, null, 2) + '\n');
      return send(res, 200, { ok: true, action: body.action });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    // readBody already answered (413) and destroyed the socket for an oversized body;
    // writing again would throw on a dead response.
    if (res.headersSent || res.writableEnded) return;
    return send(res, 400, { error: String(e && e.message) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`LOOM_SERVER_PORT=${server.address().port}\n`);
});

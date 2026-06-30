#!/usr/bin/env node
/*
 * Deterministic PII / secret redaction for lirbox:feedback.
 * Pure Node — reads stdin, writes the scrubbed text to stdout. NO network, NO fs writes.
 * Also exports scrub() for the floor test. Over-redaction is the safe failure mode; the skill's
 * human-confirm gate lets the user correct false positives before anything is published.
 */
'use strict';

function scrub(input) {
  let s = String(input);
  const users = new Set();

  // Home-dir paths → <home> (capture username for standalone redaction). Consume the whole path.
  s = s.replace(/\/(?:Users|home)\/([A-Za-z0-9._-]+)(?:\/[^\s<>()]*)?/g, (_, u) => { users.add(u); return '<home>'; });

  // Emails → <email>.
  s = s.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<email>');

  // URLs with a host → <url> (before path/token rules).
  s = s.replace(/\bhttps?:\/\/[^\s<>()]+/gi, '<url>');

  // IPv4 → <ip>.
  s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>');

  // IPv6 (2+ hextet groups) → <ip>.
  s = s.replace(/\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g, '<ip>');

  // Known secret prefixes → <token>.
  s = s.replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, '<token>');
  s = s.replace(/\bsk-[A-Za-z0-9]{16,}\b/g, '<token>');
  s = s.replace(/\bAKIA[0-9A-Z]{16}\b/g, '<token>');
  s = s.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '<token>');
  s = s.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<token>'); // JWT

  // Generic high-entropy run (24+ word/-/_ chars that include a digit) → <token>.
  s = s.replace(/\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}\b/g, '<token>');

  // Remaining absolute POSIX paths (anchored on start/space/paren) → <path>, preserving the lead char.
  s = s.replace(/(^|[\s(])\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._@-]+)+/g, (_, pre) => pre + '<path>');

  // Captured usernames standalone (>=3 chars, word boundary) → <user>.
  for (const u of users) {
    if (u.length >= 3) {
      const esc = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      s = s.replace(new RegExp('\\b' + esc + '\\b', 'g'), '<user>');
    }
  }

  return s;
}

if (require.main === module) {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => process.stdout.write(scrub(Buffer.concat(chunks).toString('utf8'))));
} else {
  module.exports = { scrub };
}

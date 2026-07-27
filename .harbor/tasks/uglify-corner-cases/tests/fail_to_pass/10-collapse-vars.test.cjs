// Hidden grader (upstream issue #5854): compressing each program with the
// stated options must preserve its behavior (stdout + termination + error type).
"use strict";
const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");
const U = require(path.resolve("test", "node.js"));

function behavior(code) {
  const r = spawnSync(process.execPath, [ "-e", code ], { encoding: "utf8", timeout: 10000 });
  const err = ((r.stderr || "").match(/\b([A-Za-z]*Error)\b/) || [])[1] || "";
  return JSON.stringify({ stdout: r.stdout, ok: r.status === 0, err });
}
function check(name, options, src) {
  const ast = U.parse(src);
  const min = new U.Compressor(options, true).compress(ast).print_to_string();
  assert.strictEqual(behavior(min), behavior(src),
    name + ": compressed output behaves differently from the source\n--- source ---\n" + src + "\n--- compressed ---\n" + min);
}

check("issue_5854_1", {"collapse_vars":true}, "console.log(function(a) {\n    var b = a;\n    a++;\n    [ b[0] ] = [ \"foo\" ];\n    return a;\n}([]) ? \"PASS\" : \"FAIL\");\n");

check("issue_5854_2", {"collapse_vars":true}, "console.log(function(a) {\n    var b = a;\n    a++;\n    ({ p: b[0] } = { p: \"foo\" });\n    return a;\n}([]) ? \"PASS\" : \"FAIL\");\n");

console.log("ok");

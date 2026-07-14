// Hidden grader (upstream issue #5930): compressing each program with the
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

check("issue_5930_1", {"merge_vars":true}, "console.log(function() {\n    var a;\n    (f = a) && f();\n    {\n        const a = 42;\n        var f;\n    }\n}());\n");

check("issue_5930_2", {"collapse_vars":true,"inline":true,"merge_vars":true,"unused":true}, "\"use strict\";\n(function() {\n    f = function g(a) {\n        a.p;\n    }();\n    f && f();\n    {\n        const a = 42;\n        var b = false;\n        var f;\n    }\n})();\n");

console.log("ok");

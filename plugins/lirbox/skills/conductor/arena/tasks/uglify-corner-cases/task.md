# Fix six miscompilation bugs in the UglifyJS compressor

This repository is UglifyJS v3.17.4, a JavaScript parser/compressor/minifier. Users
have reported six independent programs that the compressor **miscompiles**: the
compressed output behaves differently from the source program. Your job is to fix the
compressor — the code under `lib/` — so that every program below compresses to
behavior-identical code.

## Ground rules

1. **Behavior equality is the acceptance criterion.** For each report, the program is
   parsed and compressed exactly the way the repo's own test harness does it:
   `const U = require("./test/node.js")`, then
   `new U.Compressor(options, true).compress(U.parse(src)).print_to_string()`
   (second argument `true` = only the listed options are enabled; everything else off).
   Running the compressed code with `node -e` must produce the **same stdout, the same
   success/failure status, and the same thrown error type** as running the source.
2. **The full existing test suite must stay green**: `npm test` (this runs
   `node test/compress.js` and `node test/mocha.js`; dependencies are vendored in
   `node_modules/`, no install step needed). Fixes that repair a report below but break
   existing compress behavior are not acceptable.
3. Fix the underlying transforms — do not special-case the exact programs below, do not
   weaken the compressor into a no-op, and do not touch the test harness to make things
   pass.

## Report 1 — `collapse_vars` breaks mutation/coercion order

Options: `{ collapse_vars: true }`

```js
console.log(function(a) {
    var b = a;
    a++;
    [ b[0] ] = [ "foo" ];
    return a;
}([]) ? "PASS" : "FAIL");
```

Source prints `PASS`; compressed output prints `FAIL`. The same happens with an object
destructuring form:

```js
console.log(function(a) {
    var b = a;
    a++;
    ({ p: b[0] } = { p: "foo" });
    return a;
}([]) ? "PASS" : "FAIL");
```

Source prints `PASS`; compressed output prints `FAIL`.

## Report 2 — `hoist_vars` clobbers a function-name binding via a default value

Options: `{ collapse_vars: true, hoist_vars: true }`

```js
console.log(typeof function f(a = function() {
    f = 42;
    return f;
}()) {
    var f;
    var f;
    return a;
}());
```

Source prints `function`; compressed output prints `number`.

## Report 3 — `dead_code` changes the result of `delete` on an assignment

Options: `{ dead_code: true, pure_getters: "strict" }`

```js
console.log(delete (42..p = NaN));
```

Source prints `true`; compressed output prints `false`. The same divergence occurs with
options `{ dead_code: true, pure_getters: "strict", sequences: true, side_effects: true }`.

## Report 4 — `reduce_vars` drops a throwing property access

Options: `{ pure_getters: "strict", reduce_vars: true, side_effects: true, toplevel: true }`

```js
var a;
console || (a = function() {})(f);
function f() {
    a.p;
}
try {
    f();
    console.log("FAIL");
} catch (e) {
    console.log("PASS");
}
```

Source prints `PASS` (`a.p` throws on undefined `a`); compressed output prints `FAIL`.

## Report 5 — `merge_vars` merges a `var` into a `const`'s block scope

Options: `{ merge_vars: true }`

```js
console.log(function() {
    var a;
    (f = a) && f();
    {
        const a = 42;
        var f;
    }
}());
```

Source prints `undefined`; compressed output is not even valid JavaScript — it throws
`SyntaxError: Identifier 'a' has already been declared`. A second variant, with options
`{ collapse_vars: true, inline: true, merge_vars: true, unused: true }`:

```js
"use strict";
(function() {
    f = function g(a) {
        a.p;
    }();
    f && f();
    {
        const a = 42;
        var b = false;
        var f;
    }
})();
```

Source throws a `TypeError`; compressed output instead throws the same `SyntaxError` as
above.

## Report 6 — `evaluate` erases a live side effect

Options: `{ conditionals: true, evaluate: true, sequences: true, side_effects: true, unused: true }`

```js
(function f(a) {
    f && (console, 42) && (f && (a = [])) && console.log("PASS");
    f = 42;
})();
```

Source prints `PASS`; compressed output prints nothing.

## Deliverable

Fix all six reports in `lib/` with `npm test` green. The fixes are expected to be small
and surgical — the difficulty is locating the faulty logic and repairing it without
regressing any of the existing compress test cases.

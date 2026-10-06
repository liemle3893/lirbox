#!/usr/bin/env python3
"""Reverse-import graph for pytest selection (python3 stdlib only).

stdin : {"root": "<package dir>", "tests": ["tests/test_a.py", ...], "changed": ["pkg/mod.py", ...]}
        paths are relative to root.
stdout: {"map": {"<changed file>": ["<test file>", ...]}}
        with "edges": true in the request, the import graph instead: {"edges": {"<file>": ["<file it imports>", ...]}}

A test is related to a changed module when it imports it, directly or through any chain of
imports. A changed conftest.py relates to every test under its directory. A changed test file
relates to itself. Not seen: importlib / __import__ with computed names, plugins loaded by entry
point, files read at run time (those are `parts`).
"""
import ast
import json
import os
import sys

SKIP = {".git", "node_modules", "__pycache__", ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache", "build", "dist", ".eggs"}


def collect(root):
    out = []
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP and not x.endswith(".egg-info")]
        for f in files:
            if f.endswith(".py"):
                out.append(os.path.relpath(os.path.join(d, f), root).replace(os.sep, "/"))
    return out


def module_names(rel):
    """Dotted names a file can be imported as. src/ and lib/ layouts import without the prefix."""
    stem = rel[:-3]
    parts = stem.split("/")
    if parts[-1] == "__init__":
        parts = parts[:-1]
    names = [".".join(parts)] if parts else []
    if len(parts) > 1 and parts[0] in ("src", "lib"):
        names.append(".".join(parts[1:]))
    return [n for n in names if n]


def imports_of(path, rel, own_pkg_names):
    try:
        with open(path, "rb") as fh:
            tree = ast.parse(fh.read(), filename=path)
    except (SyntaxError, ValueError, OSError):
        return set()
    found = set()
    is_init = rel.endswith("__init__.py")
    # package this file lives in, as dotted names (for relative imports)
    pkg = rel[:-3].split("/")
    if not is_init:
        pkg = pkg[:-1]
    bases = [".".join(pkg)] if pkg else [""]
    if pkg and pkg[0] in ("src", "lib") and len(pkg) > 1:
        bases.append(".".join(pkg[1:]))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                found.add(a.name)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                for b in bases:
                    parts = b.split(".") if b else []
                    up = node.level - 1
                    if up > len(parts):
                        continue
                    base = parts[: len(parts) - up] if up else parts
                    target = ".".join(base + ([node.module] if node.module else []))
                    if target:
                        found.add(target)
                        for a in node.names:
                            found.add(target + "." + a.name)
            elif node.module:
                found.add(node.module)
                for a in node.names:
                    found.add(node.module + "." + a.name)
    return found


def main():
    req = json.load(sys.stdin)
    root = req["root"]
    tests = set(req.get("tests", []))
    changed = req.get("changed", [])
    files = collect(root)
    by_name = {}
    for rel in files:
        for n in module_names(rel):
            by_name.setdefault(n, rel)
    importers = {}  # file -> set(files that import it)
    forward = {}  # file -> set(files it imports)
    for rel in files:
        for name in imports_of(os.path.join(root, rel), rel, by_name):
            parts = name.split(".")
            # importing a.b.c also runs a/__init__ and a/b/__init__
            for i in range(1, len(parts) + 1):
                target = by_name.get(".".join(parts[:i]))
                if target and target != rel:
                    importers.setdefault(target, set()).add(rel)
                    forward.setdefault(rel, set()).add(target)
    if req.get("edges"):
        json.dump({"edges": {k: sorted(v) for k, v in forward.items()}}, sys.stdout)
        return
    result = {}
    for ch in changed:
        seen, stack = {ch}, [ch]
        while stack:
            cur = stack.pop()
            for imp in importers.get(cur, ()):
                if imp not in seen:
                    seen.add(imp)
                    stack.append(imp)
        hit = {t for t in seen if t in tests}
        if os.path.basename(ch) == "conftest.py":
            d = os.path.dirname(ch)
            hit |= {t for t in tests if d == "" or t.startswith(d + "/")}
        result[ch] = sorted(hit)
    json.dump({"map": result}, sys.stdout)


if __name__ == "__main__":
    main()

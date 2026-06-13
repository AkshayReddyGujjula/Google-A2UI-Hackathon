"""REAL execution + differential testing for any Python function assignment.

How marking actually runs (no LLM in this file):
  - We execute the trusted REFERENCE solution and the STUDENT submission on the
    SAME set of inputs, in subprocesses with a hard timeout, and compare each
    output with a named comparator (exact / set / sorted / multiset / float /
    shortest-path). This is real code execution and is robust across arbitrary
    problems (the reference is the oracle), and it directly yields the
    input → expected vs actual rows the CaseComparison panel shows.

SECURITY SCOPE (honest, not over-claimed)
  Code runs in a temp dir via a subprocess with a hard timeout and captured
  output; no secrets are copied in. This suits the controlled submissions a TA
  marks here. It is NOT a security sandbox (a subprocess can still touch the
  filesystem / spin CPU). The documented hardening path for arbitrary untrusted
  repos is a Docker container (no network, CPU/mem limits, read-only mounts).
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from collections import Counter, deque
from pathlib import Path
from typing import Any

DEFAULT_TIMEOUT = 12  # seconds; also the guard against infinite loops

_DRIVER = """\
import json, sys
from {module} import {func} as _fn
cases = json.load(open("_cases.json", encoding="utf-8"))
def _enc(o):
    if isinstance(o, (set, frozenset)):
        return sorted(list(o), key=lambda x: str(x))
    if isinstance(o, tuple):
        return list(o)
    return str(o)
for c in cases:
    try:
        out = _fn(*c["args"])
        print("R:" + json.dumps({{"name": c["name"], "ok": True, "out": out}}, default=_enc), flush=True)
    except Exception as e:
        print("R:" + json.dumps({{"name": c["name"], "ok": False, "error": type(e).__name__ + ": " + str(e)}}), flush=True)
"""


def _write(target: Path, files: dict[str, str]) -> None:
    for rel, src in files.items():
        p = target / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(src, encoding="utf-8")


def _run_batch(target: Path, module: str, func: str, cases: list[dict[str, Any]],
               timeout: int) -> dict[str, Any]:
    """Run `func` (imported from `module`) over every case in one subprocess.
    Returns {results: {name: {...}}, timed_out_case: name|None, fatal: str|None}."""
    (target / "_cases.json").write_text(json.dumps(cases), encoding="utf-8")
    (target / "_driver.py").write_text(_DRIVER.format(module=module, func=func), encoding="utf-8")
    stdout = ""
    timed_out = False
    fatal = None
    try:
        proc = subprocess.run([sys.executable, "_driver.py"], cwd=target,
                              capture_output=True, text=True, timeout=timeout)
        stdout, stderr = proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as e:
        timed_out = True
        stdout = e.stdout or ""
        stderr = e.stderr or ""
    except Exception as exc:  # noqa: BLE001
        return {"results": {}, "timed_out_case": None, "fatal": f"could not start runner: {exc}"}

    results: dict[str, Any] = {}
    for line in stdout.splitlines():
        if line.startswith("R:"):
            try:
                rec = json.loads(line[2:])
                results[rec["name"]] = rec
            except json.JSONDecodeError:
                pass
    if not results and not timed_out:
        # nothing ran — almost always an import error (missing entry function)
        fatal = (stderr or "submission failed to import (missing entry function or syntax error)").strip()[-500:]

    timed_out_case = None
    if timed_out:
        for c in cases:
            if c["name"] not in results:
                timed_out_case = c["name"]
                break
    return {"results": results, "timed_out_case": timed_out_case, "fatal": fatal}


# ── comparators ───────────────────────────────────────────────────────────────────
def _as_list(x: Any) -> list[Any]:
    return list(x) if isinstance(x, (list, tuple)) else [x]


def _close(a: Any, b: Any, tol: float = 1e-6) -> bool:
    try:
        la, lb = _as_list(a), _as_list(b)
        return len(la) == len(lb) and all(abs(float(x) - float(y)) <= tol for x, y in zip(la, lb))
    except (TypeError, ValueError):
        return a == b


def _valid_shortest_path(args: list[Any], actual: Any, expected: Any) -> bool:
    if expected is None:
        return actual is None
    if not isinstance(actual, list) or not actual:
        return False
    graph, start, goal = args[0], args[1], args[2]
    if actual[0] != start or actual[-1] != goal:
        return False
    for a, b in zip(actual, actual[1:]):
        if b not in graph.get(a, []):
            return False
    return len(actual) == len(expected)  # reference path is shortest → minimal length


def compare(comparator: str, args: list[Any], actual: Any, expected: Any) -> bool:
    if comparator == "shortest_path_unweighted":
        return _valid_shortest_path(args, actual, expected)
    if comparator == "set_equal":
        try:
            return set(map(_hash, _as_list(actual))) == set(map(_hash, _as_list(expected)))
        except TypeError:
            return actual == expected
    if comparator == "sorted_equal":
        try:
            return sorted(_as_list(actual), key=lambda x: str(x)) == sorted(_as_list(expected), key=lambda x: str(x))
        except TypeError:
            return actual == expected
    if comparator == "multiset_equal":
        try:
            return Counter(map(_hash, _as_list(actual))) == Counter(map(_hash, _as_list(expected)))
        except TypeError:
            return actual == expected
    if comparator == "float_close":
        return _close(actual, expected)
    return actual == expected  # exact


def _hash(x: Any) -> Any:
    return tuple(x) if isinstance(x, list) else x


# ── public API ──────────────────────────────────────────────────────────────────
def probe_reference(reference_source: str, entry_func: str, cases: list[dict[str, Any]],
                    comparator: str, timeout: int = DEFAULT_TIMEOUT) -> list[dict[str, Any]]:
    """Run the reference on every case; report which executed cleanly + the output."""
    if not cases:
        return []
    with tempfile.TemporaryDirectory(prefix="pr_ref_") as tmp:
        target = Path(tmp)
        _write(target, {"_reference.py": reference_source})
        batch = _run_batch(target, "_reference", entry_func, cases, timeout)
    out = []
    for c in cases:
        rec = batch["results"].get(c["name"])
        out.append({
            "name": c["name"],
            "reference_ok": bool(rec and rec.get("ok")),
            "expected": rec.get("out") if rec and rec.get("ok") else None,
            "error": (rec or {}).get("error"),
        })
    return out


def run_diff_tests(reference_source: str, student_files: dict[str, str], entry_module: str,
                   entry_func: str, cases: list[dict[str, Any]], comparator: str,
                   timeout: int = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Execute reference + student on every case and compare. Returns per-case
    results (input/expected/actual/passed) + a summary. Never raises."""
    if not cases:
        return {"ok": False, "cases": [], "summary": {"total": 0, "passed": 0, "failed": 0},
                "error": "no test cases"}

    # 1. expected outputs from the reference
    with tempfile.TemporaryDirectory(prefix="pr_ref_") as tmp:
        target = Path(tmp)
        _write(target, {"_reference.py": reference_source})
        ref_batch = _run_batch(target, "_reference", entry_func, cases, timeout)
    expected = {n: r.get("out") for n, r in ref_batch["results"].items() if r.get("ok")}

    # 2. student outputs
    with tempfile.TemporaryDirectory(prefix="pr_stu_") as tmp:
        target = Path(tmp)
        _write(target, student_files)
        (target / "student_entry.py").write_text(
            f"from {entry_module} import {entry_func} as {entry_func}\n", encoding="utf-8"
        )
        stu_batch = _run_batch(target, "student_entry", entry_func, cases, timeout)

    if stu_batch["fatal"]:
        return {"ok": False, "cases": [],
                "summary": {"total": len(cases), "passed": 0, "failed": len(cases)},
                "fatal": stu_batch["fatal"], "timed_out": False}

    out_cases: list[dict[str, Any]] = []
    passed = 0
    for c in cases:
        name = c["name"]
        exp = expected.get(name)
        rec = stu_batch["results"].get(name)
        row: dict[str, Any] = {
            "name": name,
            "kind": c.get("kind", "correctness"),
            "input": c["args"],
            "expected": exp,
        }
        if name == stu_batch["timed_out_case"] or (rec is None and stu_batch["timed_out_case"]):
            row.update(status="failed", actual=None,
                       message=f"timed out after {timeout}s — likely an infinite loop")
        elif rec is None:
            row.update(status="failed", actual=None, message="no output captured")
        elif not rec.get("ok"):
            row.update(status="failed", actual=None, message=rec.get("error", "raised an exception"))
        else:
            actual = rec.get("out")
            row["actual"] = actual
            ok = compare(comparator, c["args"], actual, exp)
            if ok:
                row["status"] = "passed"
                passed += 1
            else:
                row.update(status="failed",
                           message=f"expected {_short(exp)} but got {_short(actual)}")
        out_cases.append(row)

    return {
        "ok": True,
        "cases": out_cases,
        "summary": {"total": len(out_cases), "passed": passed, "failed": len(out_cases) - passed},
        "timed_out": bool(stu_batch["timed_out_case"]),
        "comparator": comparator,
    }


def _short(v: Any, n: int = 120) -> str:
    s = json.dumps(v) if not isinstance(v, str) else v
    return s if len(s) <= n else s[: n - 1] + "…"


# ── graph trace (graph-type assignments only) ─────────────────────────────────────
def _bfs_layers(graph: dict[str, list[str]], start: str) -> dict[str, int]:
    dist = {start: 0}
    q = deque([start])
    while q:
        node = q.popleft()
        for nxt in graph.get(node, []):
            if nxt not in dist:
                dist[nxt] = dist[node] + 1
                q.append(nxt)
    return dist


def build_trace_from_case(args: list[Any], expected_path: Any, student_path: Any) -> dict[str, Any] | None:
    """Build VisualGraphTracePanel data from a shortest-path case: positions by BFS
    layer, edges, expected vs the student's returned path."""
    if not args or not isinstance(args[0], dict):
        return None
    graph, start, goal = args[0], args[1], args[2]
    dist = _bfs_layers(graph, start)
    max_layer = max(dist.values(), default=0)
    unreachable_col = max_layer + 1
    columns: dict[int, list[str]] = {}
    for node in graph:
        columns.setdefault(dist.get(node, unreachable_col), []).append(node)
    total_cols = (max(columns) if columns else 0) + 1
    nodes = []
    for col, members in columns.items():
        members.sort()
        for idx, node in enumerate(members):
            nodes.append({"id": node, "x": round((col + 0.5) / total_cols, 4),
                          "y": round((idx + 0.5) / len(members), 4), "layer": dist.get(node)})
    edges = [{"from": a, "to": b} for a, nbrs in graph.items() for b in nbrs]
    exp_len = (len(expected_path) - 1) if isinstance(expected_path, list) else None
    stu_len = (len(student_path) - 1) if isinstance(student_path, list) else None
    return {
        "nodes": nodes, "edges": edges, "start": start, "goal": goal,
        "expected_path": expected_path, "student_path": student_path,
        "expected_edges": exp_len, "student_edges": stu_len,
        "is_minimal": (stu_len is not None and stu_len == exp_len),
    }

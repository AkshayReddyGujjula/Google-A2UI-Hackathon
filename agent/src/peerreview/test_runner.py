"""REAL execution of the frozen test suite + deterministic graph traces.

SECURITY SCOPE (honest, not over-claimed)
==========================================
The MVP runner executes code in a temp directory via a subprocess with a hard
timeout and captured output, and copies NO secrets into that directory. This is
adequate for the CONTROLLED DEMO submissions in this repo. It is NOT a security
sandbox: a subprocess can still touch the filesystem, spin CPU, etc. Before
trusting arbitrary public GitHub repos, the intended hardening (documented in
the README) is a Docker container with no network, CPU/memory limits, and a
read-only test mount. We deliberately do not call this a "secure sandbox".
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from collections import deque
from pathlib import Path
from typing import Any

DEFAULT_TIMEOUT = 12  # seconds; also our guard against infinite loops in student code

# Sample graph used to visualise BFS layers vs the student's traversal. Chosen
# so a depth-first strategy returns a valid but NON-minimal path (A-B-C-D-E-G,
# 5 edges) while BFS finds A-F-G (2 edges).
SAMPLE_GRAPH: dict[str, list[str]] = {
    "A": ["B", "F"],
    "B": ["C"],
    "C": ["D"],
    "D": ["E"],
    "E": ["G"],
    "F": ["G"],
    "G": [],
}
SAMPLE_START = "A"
SAMPLE_GOAL = "G"


def _write_workspace_dir(
    target: Path,
    code_files: dict[str, str],
    tests_source: str,
    entry_module: str,
    entry_func: str,
    exported_name: str,
) -> None:
    """Lay out a temp run dir: student/reference code, the frozen test file,
    and a student_entry shim that re-exports the entry function under the name
    the tests import (`exported_name`)."""
    for rel, src in code_files.items():
        p = target / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(src, encoding="utf-8")
    alias = "" if entry_func == exported_name else f" as {exported_name}"
    (target / "student_entry.py").write_text(
        f"from {entry_module} import {entry_func}{alias}\n", encoding="utf-8"
    )
    (target / "test_frozen.py").write_text(tests_source, encoding="utf-8")


def _parse_junit(xml_path: Path) -> list[dict[str, Any]]:
    if not xml_path.exists():
        return []
    tree = ET.parse(xml_path)
    root = tree.getroot()
    results: list[dict[str, Any]] = []
    for case in root.iter("testcase"):
        name = case.get("name", "test")
        failure = case.find("failure")
        error = case.find("error")
        skipped = case.find("skipped")
        if failure is not None:
            status, node = "failed", failure
        elif error is not None:
            status, node = "error", error
        elif skipped is not None:
            status, node = "skipped", skipped
        else:
            status, node = "passed", None
        message = (node.get("message", "") if node is not None else "").strip()
        detail = ((node.text or "") if node is not None else "").strip()
        results.append(
            {
                "name": name,
                "status": status,
                "message": message[:400],
                "detail": detail[-1200:],
            }
        )
    return results


def run_pytest(
    code_files: dict[str, str],
    tests_source: str,
    entry_module: str,
    entry_func: str,
    exported_name: str,
    timeout: int = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Execute the frozen test suite against the given code. Returns per-test
    results plus a pass/fail summary. Never raises — a crash/timeout becomes a
    reported failure."""
    with tempfile.TemporaryDirectory(prefix="pr_run_") as tmp:
        target = Path(tmp)
        junit = target / "report.xml"
        try:
            _write_workspace_dir(
                target, code_files, tests_source, entry_module, entry_func, exported_name
            )
        except Exception as exc:  # noqa: BLE001
            return _runner_error(f"could not lay out run dir: {exc}")

        try:
            proc = subprocess.run(
                [sys.executable, "-m", "pytest", "test_frozen.py", "-q",
                 "--no-header", "-p", "no:cacheprovider", f"--junitxml={junit.name}"],
                cwd=tmp,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return _runner_error(
                f"execution exceeded {timeout}s and was terminated — likely an "
                f"infinite loop (e.g. no visited set on a cyclic graph).",
                timed_out=True,
            )
        except Exception as exc:  # noqa: BLE001
            return _runner_error(f"could not start pytest: {exc}")

        tests = _parse_junit(junit)
        if not tests:
            # Collection error (syntax error, missing entry function, etc.)
            return _runner_error(
                "no tests ran — the submission failed to import "
                "(syntax error or missing entry function).",
                stdout=proc.stdout,
                stderr=proc.stderr,
            )
        passed = sum(1 for t in tests if t["status"] == "passed")
        failed = len(tests) - passed
        return {
            "ok": True,
            "tests": tests,
            "summary": {"total": len(tests), "passed": passed, "failed": failed},
            "stdout": proc.stdout[-2000:],
            "exit_code": proc.returncode,
        }


def _runner_error(msg: str, **extra: Any) -> dict[str, Any]:
    return {"ok": False, "error": msg, "tests": [], "summary": {"total": 0, "passed": 0, "failed": 0}, **extra}


def validate_tests_against_reference(
    reference_source: str,
    tests_source: str,
    entry_func: str,
    exported_name: str,
    timeout: int = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Run the (possibly LLM-generated) tests against the trusted reference
    solution. Tests the reference fails are INVALID and must not be frozen.
    Returns {valid: bool, results: [...], invalid: [names]}."""
    result = run_pytest(
        code_files={"reference_solution.py": reference_source},
        tests_source=tests_source,
        entry_module="reference_solution",
        entry_func=entry_func,
        exported_name=exported_name,
        timeout=timeout,
    )
    if not result["ok"]:
        return {"valid": False, "results": [], "invalid": [], "error": result.get("error")}
    invalid = [t["name"] for t in result["tests"] if t["status"] != "passed"]
    return {
        "valid": len(invalid) == 0,
        "results": result["tests"],
        "invalid": invalid,
        "summary": result["summary"],
    }


# ── deterministic graph trace (no LLM) ──────────────────────────────────────────
def _bfs_layers(graph: dict[str, list[str]], start: str) -> dict[str, int]:
    """Distance (in edges) from start to each reachable node."""
    dist = {start: 0}
    q = deque([start])
    while q:
        node = q.popleft()
        for nxt in graph.get(node, []):
            if nxt not in dist:
                dist[nxt] = dist[node] + 1
                q.append(nxt)
    return dist


def _reference_shortest_path(graph, start, goal) -> list[str] | None:
    if start == goal:
        return [start]
    visited = {start}
    q: deque[list[str]] = deque([[start]])
    while q:
        path = q.popleft()
        for nxt in graph.get(path[-1], []):
            if nxt == goal:
                return path + [nxt]
            if nxt not in visited:
                visited.add(nxt)
                q.append(path + [nxt])
    return None


def run_student_function(
    code_files: dict[str, str],
    entry_module: str,
    entry_func: str,
    graph: dict[str, list[str]],
    start: str,
    goal: str,
    timeout: int = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Execute the student's function on the sample graph in a subprocess and
    capture what it returns (untrusted — same scope caveats as run_pytest)."""
    with tempfile.TemporaryDirectory(prefix="pr_trace_") as tmp:
        target = Path(tmp)
        for rel, src in code_files.items():
            p = target / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(src, encoding="utf-8")
        (target / "_graph.json").write_text(json.dumps(graph), encoding="utf-8")
        driver = (
            "import json\n"
            f"from {entry_module} import {entry_func} as fn\n"
            "g = json.load(open('_graph.json'))\n"
            "try:\n"
            f"    r = fn(g, {start!r}, {goal!r})\n"
            "    print('RESULT:' + json.dumps({'path': r}))\n"
            "except Exception as e:\n"
            "    print('RESULT:' + json.dumps({'error': type(e).__name__ + ': ' + str(e)}))\n"
        )
        (target / "_driver.py").write_text(driver, encoding="utf-8")
        try:
            proc = subprocess.run(
                [sys.executable, "_driver.py"],
                cwd=tmp, capture_output=True, text=True, timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return {"error": f"timed out after {timeout}s (possible infinite loop)"}
        except Exception as exc:  # noqa: BLE001
            return {"error": f"could not run student function: {exc}"}
        for line in proc.stdout.splitlines():
            if line.startswith("RESULT:"):
                try:
                    return json.loads(line[len("RESULT:"):])
                except json.JSONDecodeError:
                    break
        return {"error": "no result captured", "stderr": proc.stderr[-400:]}


def build_graph_trace(
    student_files: dict[str, str],
    entry_module: str,
    entry_func: str,
    graph: dict[str, list[str]] | None = None,
    start: str | None = None,
    goal: str | None = None,
) -> dict[str, Any]:
    """Produce the data for VisualGraphTracePanel: node positions by BFS layer,
    edges, the expected shortest path, and the student's actual returned path."""
    graph = graph or SAMPLE_GRAPH
    start = start or SAMPLE_START
    goal = goal or SAMPLE_GOAL

    dist = _bfs_layers(graph, start)
    expected = _reference_shortest_path(graph, start, goal)
    student = run_student_function(student_files, entry_module, entry_func, graph, start, goal)
    student_path = student.get("path") if isinstance(student, dict) else None

    # Position nodes in columns by BFS layer; unreachable nodes go in a final column.
    max_layer = max(dist.values(), default=0)
    unreachable_col = max_layer + 1
    columns: dict[int, list[str]] = {}
    for node in graph:
        col = dist.get(node, unreachable_col)
        columns.setdefault(col, []).append(node)
    total_cols = (max(columns) if columns else 0) + 1

    nodes = []
    for col, members in columns.items():
        members.sort()
        for idx, node in enumerate(members):
            x = (col + 0.5) / total_cols
            y = (idx + 0.5) / len(members)
            nodes.append(
                {
                    "id": node,
                    "x": round(x, 4),
                    "y": round(y, 4),
                    "layer": dist.get(node),  # None if unreachable
                }
            )
    edges = [{"from": a, "to": b} for a, nbrs in graph.items() for b in nbrs]

    expected_len = (len(expected) - 1) if expected else None
    student_len = (len(student_path) - 1) if isinstance(student_path, list) else None
    return {
        "nodes": nodes,
        "edges": edges,
        "start": start,
        "goal": goal,
        "expected_path": expected,
        "student_path": student_path,
        "expected_edges": expected_len,
        "student_edges": student_len,
        "student_error": student.get("error") if isinstance(student, dict) else None,
        "is_minimal": (student_len is not None and student_len == expected_len),
    }

"""Evidence-based analysis: misconception detection, score proposal, feedback.

Design principle: the *decisions that carry marks* are deterministic and derived
from real test results + simple, auditable code signals — never invented by a
model. Gemini is used only to polish prose (misconception explanation, feedback
letter) on top of those facts, and there is always a templated fallback so the
pipeline runs with no API key (OFFLINE=1).
"""
from __future__ import annotations

import os
import re
from typing import Any

# ── code signals (auditable heuristics) ─────────────────────────────────────────
def code_signals(code: str) -> dict[str, bool]:
    c = code.lower()
    return {
        "uses_queue": bool(re.search(r"deque|queue|popleft|fifo", c)),
        "uses_visited": "visited" in c or "seen" in c,
        "is_recursive": bool(re.search(r"def\s+\w+.*:\s*[\s\S]*?\breturn\b", c)) and _has_self_recursion(code),
        "dfs_naming": bool(re.search(r"\bdfs\b|explore|backtrack|depth.first", c)),
        "has_debug_print": bool(re.search(r"^\s*print\(", code, re.MULTILINE)),
    }


def _has_self_recursion(code: str) -> bool:
    m = re.findall(r"def\s+(\w+)\s*\(", code)
    for name in m:
        # a call to the function inside the body (excluding the def line)
        body = re.sub(rf"def\s+{name}\s*\([^)]*\)\s*:", "", code)
        if re.search(rf"\b{name}\s*\(", body):
            return True
    return False


def _failed(tests: list[dict], *needles: str) -> bool:
    return any(t["status"] != "passed" and any(n in t["name"] for n in needles) for t in tests)


def _passed(tests: list[dict], *needles: str) -> bool:
    rel = [t for t in tests if any(n in t["name"] for n in needles)]
    return bool(rel) and all(t["status"] == "passed" for t in rel)


# ── misconception detection ──────────────────────────────────────────────────────
def detect_misconception(test_results: dict, code: str) -> dict[str, Any]:
    tests = test_results.get("tests", [])
    sig = code_signals(code)

    if test_results.get("timed_out"):
        return {
            "detected": True,
            "label": "missing_visited_set",
            "title": "Possible infinite loop (no visited set)",
            "severity": "high",
            "evidence": ["Execution exceeded the time limit on a cyclic graph — typically a missing visited/seen set."],
        }

    minimal_failed = _failed(tests, "minimal")
    endpoints_ok = _passed(tests, "endpoints", "edges_exist")
    if minimal_failed and endpoints_ok:
        ev = []
        for t in tests:
            if "minimal" in t["name"] and t["status"] != "passed":
                ev.append(t["message"] or "Returned a valid path that is not the shortest.")
        if sig["is_recursive"] or sig["dfs_naming"] or not sig["uses_queue"]:
            ev.append("Code uses a recursive depth-first traversal (no FIFO queue), so it returns the first path found rather than the shortest.")
        return {
            "detected": True,
            "label": "dfs_instead_of_bfs",
            "title": "Depth-first traversal instead of breadth-first search",
            "severity": "high",
            "explanation": (
                "The submission explores one branch to its end before trying others (depth-first), "
                "so it returns a valid but non-shortest path. BFS explores the graph layer by layer "
                "with a FIFO queue, guaranteeing the fewest edges to the goal in an unweighted graph."
            ),
            "evidence": ev,
        }

    if _failed(tests, "unreachable"):
        return {
            "detected": True,
            "label": "missing_unreachable_case",
            "title": "Unreachable goal not handled",
            "severity": "medium",
            "evidence": ["The function does not return None when the goal cannot be reached."],
        }

    if test_results.get("summary", {}).get("failed", 0) == 0:
        return {"detected": False, "label": None, "title": "No misconception detected", "severity": "none", "evidence": []}

    # Generic fallback
    failed_names = [t["name"] for t in tests if t["status"] != "passed"]
    return {
        "detected": True,
        "label": "failing_tests",
        "title": "Some frozen tests fail",
        "severity": "medium",
        "evidence": [f"Failing: {', '.join(failed_names)}"],
    }


# ── score proposal (deterministic, clamped to rubric maxima) ─────────────────────
def propose_scores(rubric: dict, test_results: dict, misconception: dict, code: str) -> list[dict[str, Any]]:
    tests = test_results.get("tests", [])
    sig = code_signals(code)
    minimal_failed = _failed(tests, "minimal")
    label = misconception.get("label")

    out: list[dict[str, Any]] = []
    for crit in rubric.get("criteria", []):
        cid, mx = crit["id"], crit["max"]
        score, rationale = mx, ""

        if cid == "correctness":
            rel = [t for t in tests if any(n in t["name"] for n in ("minimal", "endpoints", "edges", "valid_shortest"))]
            frac = (sum(1 for t in rel if t["status"] == "passed") / len(rel)) if rel else 1.0
            score = round(mx * frac)
            if minimal_failed:  # shortest-path is the core requirement — cap it
                score = min(score, mx // 2)
                rationale = "Returns a valid path but not the shortest (minimal-edge) one — the core requirement."
            else:
                rationale = f"{sum(1 for t in rel if t['status']=='passed')}/{len(rel)} correctness tests pass."

        elif cid == "algorithmic_understanding":
            if label == "dfs_instead_of_bfs":
                score, rationale = max(1, mx // 3), "Depth-first recursion rather than a level-order BFS queue."
            elif sig["uses_queue"] and sig["uses_visited"]:
                score, rationale = mx, "Uses a FIFO queue + visited set — a correct breadth-first strategy."
            else:
                score, rationale = max(1, mx - 1), "BFS structures (queue/visited) not clearly present."

        elif cid == "edge_cases":
            ok = _passed(tests, "start_equals_goal") and not _failed(tests, "unreachable", "cycle")
            score = mx if ok else 0
            rationale = "Handles start==goal, unreachable, and cyclic graphs." if ok else "One or more edge cases fail."

        elif cid == "code_quality":
            if sig["has_debug_print"]:
                score, rationale = max(0, mx - 1), "Leftover debug print statements."
            else:
                score, rationale = mx, "Readable and reasonably structured."
        else:
            # Unknown criterion: scale by overall pass rate.
            s = test_results.get("summary", {})
            frac = (s.get("passed", 0) / s.get("total", 1)) if s.get("total") else 1.0
            score, rationale = round(mx * frac), f"{s.get('passed',0)}/{s.get('total',0)} tests pass."

        out.append({"id": cid, "label": crit["label"], "max": mx, "proposed": max(0, min(mx, score)), "rationale": rationale})
    return out


# ── feedback letter (templated; Gemini-polished when available) ──────────────────
def build_feedback(rubric: dict, scorecard: list[dict], misconception: dict, reference: dict | None,
                   include_resource: bool, total: int, max_total: int) -> dict[str, Any]:
    passed_pts = ", ".join(c["label"] for c in scorecard if c["proposed"] == c["max"])
    paras: list[str] = []
    paras.append(
        f"Thanks for your submission to “{rubric.get('title','this assignment')}”. "
        f"Overall you scored {total} out of {max_total}."
    )
    if passed_pts:
        paras.append(f"What you did well: full marks on {passed_pts}.")
    if misconception.get("detected"):
        if misconception["label"] == "dfs_instead_of_bfs":
            paras.append(
                "The main issue is the traversal strategy. Your code finds a valid path, but it explores "
                "one branch all the way down before trying others (depth-first), so it can return a path "
                "that is longer than necessary. Breadth-first search explores the graph layer by layer using "
                "a FIFO queue and a visited set, so the first time it reaches the goal it has used the fewest "
                "possible edges — the shortest path in an unweighted graph."
            )
        else:
            paras.append(f"Area to revisit: {misconception.get('title','')}. " + " ".join(misconception.get("evidence", [])[:1]))
    if include_resource and reference and reference.get("sources"):
        src = reference["sources"][0]
        paras.append(f"Optional reading: {src.get('name','reference')} — {src.get('url','')}")

    plain = "\n\n".join(paras)
    return {
        "greeting": "Feedback on your submission",
        "letter_paragraphs": _maybe_polish(paras),
        "plain_text": plain,
    }


# ── optional Gemini prose polish ─────────────────────────────────────────────────
def _maybe_polish(paragraphs: list[str]) -> list[str]:
    """Hook for LLM polish. Kept conservative: only runs online and never
    invents facts (it rewrites the given paragraphs). Falls back to the input
    on any error so the pipeline is deterministic without a key."""
    if os.getenv("OFFLINE") == "1" or not os.getenv("GEMINI_API_KEY"):
        return paragraphs
    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
        from langchain_core.messages import SystemMessage, HumanMessage

        model = ChatGoogleGenerativeAI(model=os.getenv("MODEL", "gemini-3.5-flash"),
                                       google_api_key=os.getenv("GEMINI_API_KEY"), temperature=0.3)
        prompt = (
            "Rewrite the following student feedback so it is warm, concise, and encouraging. "
            "Do NOT change any facts, scores, or the technical explanation. Keep it to the same "
            "number of short paragraphs. Return the paragraphs separated by a blank line.\n\n"
            + "\n\n".join(paragraphs)
        )
        resp = model.invoke([SystemMessage(content="You are a supportive CS teaching assistant."),
                             HumanMessage(content=prompt)])
        text = resp.content if isinstance(resp.content, str) else str(resp.content)
        out = [p.strip() for p in text.split("\n\n") if p.strip()]
        return out or paragraphs
    except Exception:  # noqa: BLE001
        return paragraphs

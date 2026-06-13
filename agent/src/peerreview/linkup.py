"""LinkUp source-grounded reference lookup.

Used ONLY to fetch explanation context for the concepts an assignment covers
(e.g. "why BFS gives shortest paths in unweighted graphs"). It is deliberately
kept OUT of the grading path: references inform TA-facing explanations and the
optional learning resource included in student feedback — they never change a
score, the rubric, or the frozen tests.

Falls back to a bundled, clearly-labelled reference when LINKUP_API_KEY is
unset, OFFLINE=1, or the API call fails, so the panel is always populated for
a demo. The `grounded` flag tells the UI whether the content came from a live
LinkUp call or the offline fallback.
"""
from __future__ import annotations

import os
from typing import Any

LINKUP_ENDPOINT = "https://api.linkup.so/v1/search"

# Bundled fallback so the ReferenceContextPanel always renders something.
_FALLBACK = {
    "answer": (
        "Breadth-first search (BFS) explores a graph in layers: all nodes at "
        "distance 1 from the start, then distance 2, and so on. Because it reaches "
        "every node by the fewest edges first, the first time BFS encounters the "
        "goal it has found a shortest path in an unweighted graph. Depth-first "
        "search instead follows one branch to its end before backtracking, so it "
        "can return a valid but longer path."
    ),
    "sources": [
        {
            "name": "Breadth-first search — shortest paths (reference)",
            "url": "https://en.wikipedia.org/wiki/Breadth-first_search",
            "snippet": "BFS computes shortest paths (fewest edges) from a source "
            "in an unweighted graph by exploring nodes in order of distance.",
        },
        {
            "name": "BFS vs DFS for pathfinding",
            "url": "https://en.wikipedia.org/wiki/Depth-first_search",
            "snippet": "DFS explores as far as possible along each branch before "
            "backtracking; it finds a path but not necessarily the shortest one.",
        },
    ],
}


def reference_lookup(topic: str, *, max_sources: int = 3) -> dict[str, Any]:
    """Return {topic, answer, sources, grounded, used_for, grading_impact}."""
    base = {
        "reference_topic": topic,
        "used_for": "TA-facing explanation context and optional learning resource only",
        "grading_impact": "No scoring impact — grading uses the rubric, frozen tests, code evidence, and TA approval.",
    }

    api_key = os.getenv("LINKUP_API_KEY")
    if os.getenv("OFFLINE") == "1" or not api_key:
        return {
            **base,
            "grounded": False,
            "answer": _FALLBACK["answer"],
            "sources": _FALLBACK["sources"][:max_sources],
        }

    try:
        import requests

        resp = requests.post(
            LINKUP_ENDPOINT,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"q": topic, "depth": "standard", "outputType": "sourcedAnswer"},
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
        sources = [
            {
                "name": s.get("name") or s.get("title") or "source",
                "url": s.get("url", ""),
                "snippet": (s.get("snippet") or "")[:240],
            }
            for s in (data.get("sources") or [])[:max_sources]
        ]
        return {
            **base,
            "grounded": True,
            "answer": data.get("answer", _FALLBACK["answer"]),
            "sources": sources or _FALLBACK["sources"][:max_sources],
        }
    except Exception as exc:  # noqa: BLE001 — never let a lookup break the workflow
        return {
            **base,
            "grounded": False,
            "answer": _FALLBACK["answer"],
            "sources": _FALLBACK["sources"][:max_sources],
            "note": f"LinkUp call failed ({exc}); showing bundled reference.",
        }

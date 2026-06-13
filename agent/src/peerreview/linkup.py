"""LinkUp source-grounded reference lookup.

References are explanation-only: they can help the TA and optionally appear in
student feedback, but they never affect scores, rubrics, or frozen tests.
"""
from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlparse

LINKUP_ENDPOINT = "https://api.linkup.so/v1/search"

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
            "name": "MIT OCW 6.006: Breadth-First Search",
            "url": "https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-fall-2011/resources/lecture-13-breadth-first-search-bfs/",
            "snippet": "University lecture material covering graph representations, BFS traversal, and shortest paths.",
        },
        {
            "name": "VisuAlgo: DFS/BFS graph traversal",
            "url": "https://visualgo.net/en/dfsbfs",
            "snippet": "Interactive visualizations for BFS and DFS, useful for seeing layer-by-layer exploration.",
        },
        {
            "name": "CP-Algorithms: Breadth First Search",
            "url": "https://cp-algorithms.com/graph/breadth-first-search.html",
            "snippet": "Concise implementation notes and shortest-path reconstruction details for BFS.",
        },
    ],
}

_LOW_VALUE_DOMAINS = {
    "multiplechoicequestions.org",
    "examradar.com",
    "indiabix.com",
}

_TRUSTED_DOMAIN_WEIGHTS = {
    "ocw.mit.edu": 100,
    "visualgo.net": 95,
    "cp-algorithms.com": 90,
    "cs.usfca.edu": 85,
    "geeksforgeeks.org": 45,
    "wikipedia.org": 35,
}


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().removeprefix("www.")
    except Exception:
        return ""


def _source_score(source: dict[str, Any]) -> int:
    domain = _domain(source.get("url", ""))
    if domain in _LOW_VALUE_DOMAINS:
        return -100
    base = max((w for d, w in _TRUSTED_DOMAIN_WEIGHTS.items() if domain.endswith(d)), default=10)
    text = f"{source.get('name', '')} {source.get('snippet', '')}".lower()
    if any(term in text for term in ("quiz", "multiple choice", "mcq", "interview questions")):
        base -= 60
    if any(term in text for term in ("visual", "interactive", "lecture", "shortest path", "implementation")):
        base += 15
    return base


def _polish_sources(sources: list[dict[str, Any]], max_sources: int) -> list[dict[str, Any]]:
    seen: set[str] = set()
    cleaned: list[dict[str, Any]] = []
    for src in sorted(sources, key=_source_score, reverse=True):
        url = src.get("url", "")
        if not url or url in seen or _source_score(src) < 0:
            continue
        cleaned.append(src)
        seen.add(url)
    for src in _FALLBACK["sources"]:
        if len(cleaned) >= max_sources:
            break
        if src["url"] not in seen:
            cleaned.append(src)
            seen.add(src["url"])
    return cleaned[:max_sources]


def reference_lookup(topic: str, *, max_sources: int = 3) -> dict[str, Any]:
    """Return {topic, answer, sources, grounded, used_for, grading_impact}."""
    base = {
        "reference_topic": topic,
        "used_for": "TA-facing explanation context and optional learning resource only",
        "grading_impact": "No scoring impact: grading uses the rubric, frozen tests, code evidence, and TA approval.",
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
            json={
                "q": (
                    f"{topic} teaching explanation implementation visualisation "
                    "site:ocw.mit.edu OR site:visualgo.net OR site:cp-algorithms.com"
                ),
                "depth": "standard",
                "outputType": "sourcedAnswer",
            },
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
            for s in (data.get("sources") or [])[: max_sources * 2]
        ]
        return {
            **base,
            "grounded": True,
            "answer": data.get("answer", _FALLBACK["answer"]),
            "sources": _polish_sources(sources, max_sources),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            **base,
            "grounded": False,
            "answer": _FALLBACK["answer"],
            "sources": _FALLBACK["sources"][:max_sources],
            "note": f"LinkUp call failed ({exc}); showing bundled reference.",
        }

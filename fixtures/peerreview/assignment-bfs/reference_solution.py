"""Trusted reference solution for the BFS shortest-path assignment.

PeerReview.ai runs the agent-generated test suite against THIS file before any
test is allowed into the frozen workspace. A generated test that the reference
solution fails is rejected as invalid — this is what lets a TA trust that a
green/red result reflects the student's code, not a hallucinated test.

It is also used (deterministically, no LLM) to compute the expected BFS layers
and the canonical shortest path for the VisualGraphTracePanel.
"""
from __future__ import annotations

from collections import deque


def bfs_shortest_path(
    graph: dict[str, list[str]], start: str, goal: str
) -> list[str] | None:
    """Return a minimal-edge path from start to goal, or None if unreachable."""
    if start == goal:
        return [start]

    visited: set[str] = {start}
    queue: deque[list[str]] = deque([[start]])

    while queue:
        path = queue.popleft()
        node = path[-1]
        for neighbour in graph.get(node, []):
            if neighbour == goal:
                return path + [neighbour]
            if neighbour not in visited:
                visited.add(neighbour)
                queue.append(path + [neighbour])
    return None

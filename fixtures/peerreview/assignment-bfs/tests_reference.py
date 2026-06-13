"""Canonical, validated test suite for the BFS shortest-path assignment.

DESIGN NOTE — fair testing for graph search
============================================
For shortest-path problems there can be MORE THAN ONE valid shortest path
(e.g. A->B->D and A->C->D may both be length 2). Asserting an exact path
(`assert result == ["A", "B", "D"]`) would fail a perfectly correct student
who returned the other valid path. So every correctness test below asserts
PATH PROPERTIES, not an exact sequence:

  - endpoints are start and goal
  - every consecutive pair is a real edge
  - the path length equals the minimal number of edges (computed by an
    INDEPENDENT BFS inside this test — not by trusting the student's answer)

The minimal-length property is what distinguishes a real BFS from a DFS that
merely returns *a* valid path: a DFS can return a longer path, which fails
`test_path_is_minimal` while still passing the endpoint/edge tests.

The student's function is exposed as `student_entry.bfs_shortest_path`; the
runner writes student_entry.py to re-export whichever file/function it found
(or the reference solution, during validation).
"""
from collections import deque

from student_entry import bfs_shortest_path


# ── independent ground-truth helpers (do NOT call the student's code) ──────────
def _min_edges(graph, start, goal):
    """Minimal number of edges from start to goal, or None if unreachable."""
    if start == goal:
        return 0
    seen = {start}
    q = deque([(start, 0)])
    while q:
        node, dist = q.popleft()
        for nxt in graph.get(node, []):
            if nxt == goal:
                return dist + 1
            if nxt not in seen:
                seen.add(nxt)
                q.append((nxt, dist + 1))
    return None


def _edges_exist(graph, path):
    return all(path[i + 1] in graph.get(path[i], []) for i in range(len(path) - 1))


# ── sample graphs ─────────────────────────────────────────────────────────────
# DFS trap: visiting 'B' first leads down a 5-edge branch; the shortest path
# A -> F -> G is only 2 edges. A correct BFS finds length 2.
TRAP = {
    "A": ["B", "F"],
    "B": ["C"],
    "C": ["D"],
    "D": ["E"],
    "E": ["G"],
    "F": ["G"],
    "G": [],
}

# Diamond: two equally-short paths A->B->D and A->C->D. Either is acceptable.
DIAMOND = {"A": ["B", "C"], "B": ["D"], "C": ["D"], "D": []}

# Cyclic graph: must terminate.
CYCLE = {"A": ["B"], "B": ["C"], "C": ["A", "D"], "D": []}


# ── tests ──────────────────────────────────────────────────────────────────────
def test_start_equals_goal():
    assert bfs_shortest_path(TRAP, "A", "A") == ["A"]


def test_unreachable_returns_none():
    # Nothing points to 'A', so from 'G' it is unreachable.
    assert bfs_shortest_path(TRAP, "G", "A") is None


def test_path_endpoints():
    path = bfs_shortest_path(TRAP, "A", "G")
    assert path is not None
    assert path[0] == "A" and path[-1] == "G"


def test_path_edges_exist():
    path = bfs_shortest_path(TRAP, "A", "G")
    assert path is not None
    assert _edges_exist(TRAP, path), f"path uses a non-existent edge: {path}"


def test_path_is_minimal():
    # The discriminating test: DFS returns A-B-C-D-E-G (5 edges); BFS returns
    # A-F-G (2 edges). Compare against an independent BFS distance.
    path = bfs_shortest_path(TRAP, "A", "G")
    assert path is not None
    expected = _min_edges(TRAP, "A", "G")
    assert len(path) - 1 == expected, (
        f"path has {len(path) - 1} edges but the shortest is {expected}: {path}"
    )


def test_accepts_any_valid_shortest_path():
    # Diamond has two equal shortest paths; we accept EITHER (property-based).
    path = bfs_shortest_path(DIAMOND, "A", "D")
    assert path is not None
    assert path[0] == "A" and path[-1] == "D"
    assert _edges_exist(DIAMOND, path)
    assert len(path) - 1 == _min_edges(DIAMOND, "A", "D")
    assert path in (["A", "B", "D"], ["A", "C", "D"])


def test_handles_cycle_terminates():
    # If this hangs, the runner's timeout fails it — a missing visited set.
    path = bfs_shortest_path(CYCLE, "A", "D")
    assert path is not None
    assert len(path) - 1 == _min_edges(CYCLE, "A", "D")

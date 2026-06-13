# Assignment 3 — Shortest Path in an Unweighted Graph

**Course:** CS201 Data Structures & Algorithms
**Language:** Python 3
**Topic:** Graph traversal / Breadth-First Search

## Task

Implement a function that finds the **shortest path** between two nodes in an
**unweighted, directed** graph represented as an adjacency list.

```python
def bfs_shortest_path(graph: dict[str, list[str]], start: str, goal: str) -> list[str] | None:
    ...
```

- `graph` maps each node id to the list of nodes reachable from it via one edge.
- Return the shortest path from `start` to `goal` as a list of node ids,
  **including both endpoints**, e.g. `["A", "F", "G"]`.
- "Shortest" means the path with the **fewest edges**. In an unweighted graph
  this is exactly what **breadth-first search** finds.
- If `start == goal`, return `[start]`.
- If `goal` is **unreachable** from `start`, return `None`.
- The graph may contain **cycles**; your function must still terminate.

## Why BFS

Depth-first search will find *a* path, but not necessarily the shortest one —
it commits to one branch and follows it to the end before backtracking. BFS
explores the graph layer by layer (all nodes at distance 1, then distance 2, …)
so the first time it reaches `goal`, it has found a path of minimal length.

## What we assess

1. **Correctness** — returns a valid shortest path (minimal number of edges).
2. **Algorithmic understanding** — uses a queue + visited set (BFS), not DFS.
3. **Edge cases** — `start == goal`, unreachable goal, cyclic graphs.
4. **Code quality** — readable, reasonable naming, no dead code.

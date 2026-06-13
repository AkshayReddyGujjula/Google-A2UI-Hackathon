"""Student submission (correct BFS) — used to confirm a correct answer passes
every frozen test. Not the primary demo submission."""
from collections import deque


def bfs_shortest_path(graph, start, goal):
    if start == goal:
        return [start]
    visited = {start}
    queue = deque([[start]])
    while queue:
        path = queue.popleft()
        for nxt in graph.get(path[-1], []):
            if nxt == goal:
                return path + [nxt]
            if nxt not in visited:
                visited.add(nxt)
                queue.append(path + [nxt])
    return None

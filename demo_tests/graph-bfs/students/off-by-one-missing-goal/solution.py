"""Student submission: off-by-one in the returned path.

The traversal is breadth-first, but the goal node is accidentally omitted from
the returned path when the goal is discovered.
"""

from collections import deque


def bfs_shortest_path(graph, start, goal):
    if start == goal:
        return [start]

    queue = deque([(start, [start])])
    visited = {start}

    while queue:
        node, path = queue.popleft()
        for neighbour in graph.get(node, []):
            if neighbour in visited:
                continue
            if neighbour == goal:
                return path
            visited.add(neighbour)
            queue.append((neighbour, path + [neighbour]))

    return None

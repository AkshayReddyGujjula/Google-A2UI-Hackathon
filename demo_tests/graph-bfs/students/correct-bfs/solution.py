"""Student submission: correct breadth-first shortest path.

The implementation keeps full paths in the queue. That is not the most memory-efficient
variant, but it is clear, deterministic, and appropriate for the small teaching graphs
used in the assignment.
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
            next_path = path + [neighbour]
            if neighbour == goal:
                return next_path
            visited.add(neighbour)
            queue.append((neighbour, next_path))

    return None

"""Student submission: breadth-first search with a bad unreachable-case branch."""

from collections import deque


def bfs_shortest_path(graph, start, goal):
    if start == goal:
        return [start]

    queue = deque([(start, [start])])
    seen = {start}

    while queue:
        node, path = queue.popleft()
        for neighbour in graph.get(node, []):
            if neighbour in seen:
                continue
            candidate = path + [neighbour]
            if neighbour == goal:
                return candidate
            seen.add(neighbour)
            queue.append((neighbour, candidate))

    raise RuntimeError("No route exists between the requested nodes")

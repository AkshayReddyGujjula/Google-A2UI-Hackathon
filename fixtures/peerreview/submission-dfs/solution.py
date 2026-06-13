"""Student submission — CS201 Assignment 3.

Finds a path between two nodes in a graph.
"""


def bfs_shortest_path(graph, start, goal):
    # explore the graph until we reach the goal
    visited = set()

    def explore(node, path):
        if node == goal:
            return path
        visited.add(node)
        for neighbour in graph.get(node, []):
            if neighbour not in visited:
                result = explore(neighbour, path + [neighbour])
                if result is not None:
                    return result
        return None

    if start == goal:
        return [start]
    return explore(start, [start])

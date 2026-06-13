"""Student submission: returns the first path found with recursive DFS.

It is plausible and often passes simple tests, but it does not guarantee a shortest
path in an unweighted graph.
"""


def bfs_shortest_path(graph, start, goal):
    if start == goal:
        return [start]

    visited = set()

    def explore(node, path):
        if node == goal:
            return path
        visited.add(node)
        for neighbour in graph.get(node, []):
            if neighbour in visited:
                continue
            found = explore(neighbour, path + [neighbour])
            if found is not None:
                return found
        return None

    return explore(start, [start])

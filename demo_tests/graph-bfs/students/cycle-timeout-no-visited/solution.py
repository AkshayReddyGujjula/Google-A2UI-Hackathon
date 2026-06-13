"""Student submission: no visited set.

The stack order makes the cyclic test keep revisiting A -> B -> C -> A before
it ever gets to the queued D branch, so the runner timeout catches it.
"""


def bfs_shortest_path(graph, start, goal):
    if start == goal:
        return [start]

    stack = [(start, [start])]

    while stack:
        node, path = stack.pop()
        if node == goal:
            return path
        for neighbour in reversed(graph.get(node, [])):
            stack.append((neighbour, path + [neighbour]))

    return None

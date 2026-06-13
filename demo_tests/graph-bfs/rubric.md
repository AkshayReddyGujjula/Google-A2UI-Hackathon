# Marking rubric — Shortest Path (10 marks)

- **Correctness (5 marks)** — returns a path with the minimal number of edges between
  start and goal; correct on the provided graphs.
- **Algorithmic understanding (3 marks)** — uses a breadth-first strategy: a FIFO queue
  and a visited set, rather than a depth-first traversal.
- **Edge cases (2 marks)** — handles `start == goal`, returns `None` for an unreachable
  goal, and terminates on cyclic graphs.

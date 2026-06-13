# demo_tests — ready-to-use assignments for a live demo

Nothing here is preloaded into the app. These are real files a TA uploads live, exactly
as they would during normal use.

Each assignment folder has:
- `assignment.pdf` — the student-facing brief (upload this when creating the assignment).
- `rubric.md` — an optional rubric you can upload (or let the app generate one).
- `students/<name>/solution.py` — student submissions to upload and mark.

## graph-bfs — Shortest Path (graph assignment; shows the graph-trace visual)
Upload `graph-bfs/assignment.pdf`, then mark the submissions in `graph-bfs/students/`:
- `correct-bfs` — full marks.
- `dfs-instead-of-bfs` — returns a valid but non-shortest path (the headline misconception).
- `missing-unreachable-none` — crashes instead of returning `None` for an unreachable goal.
- `cycle-timeout-no-visited` — no visited set → loops forever on a cycle (runner timeout).
- `off-by-one-missing-goal` — omits the goal node from the returned path.

## two-sum — Two Sum (non-graph assignment; proves generality)
Upload `two-sum/assignment.pdf`, then mark `two-sum/students/`:
- `correct-hashmap`, `brute-force` — both correct (full marks).
- `returns-values-not-indices` — returns the values instead of indices.
- `one-based-indices` — off-by-one (1-based indices).

You can also create a brand-new assignment from any Python-function brief to show that the
app is not hardcoded to these examples.

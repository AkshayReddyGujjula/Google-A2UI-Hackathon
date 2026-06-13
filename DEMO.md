# PeerReview.ai Live Demo

This is the exact TA-facing walkthrough for the hackathon demo. It assumes the
app is running in live mode with `GEMINI_API_KEY` present and no `OFFLINE=1` in
`.env`.

## Start

```bash
pnpm dev
```

Open `http://localhost:3000`.

## Phase 1: Freeze The Marking Workspace

1. Open `http://localhost:3000/setup`.
2. Wait for the status pill to show `agent connected`.
3. Click `Load BFS assignment`.
4. Confirm the generated workspace shows:
   - assignment summary and rubric
   - LinkUp/reference context with the explanation-only guardrail
   - validated pytest suite
   - all tests passing against the trusted reference solution
5. Click `Approve & Freeze Workspace`.
6. Confirm the frozen-workspace surface appears before moving to review.

## Phase 2: Review A Submission

1. Open `http://localhost:3000/review`.
2. Wait for `agent connected`.
3. Use one of the demo paths:
   - Click `Seeded: DFS submission` for the headline BFS-vs-DFS story.
   - Or click `Upload folder` and choose one folder under `demo-submissions/`.
   - Or paste a public GitHub repo URL that contains Python files and defines
     `bfs_shortest_path(graph, start, goal)`.
4. Confirm the review surface shows real pytest execution, not model-only
   judgement:
   - test pass/fail summary
   - failed test diagnostics
   - misconception panel
   - visual BFS trace
   - editable grade approval panel
5. Edit a score in the grade panel.
6. Click `Approve grades & generate feedback`.
7. Confirm the final feedback surface appears and includes the adjusted mark.

## Recommended Upload Order

Use these top-level folders for a clean demo arc:

1. `demo-submissions/dfs-instead-of-bfs` - valid path, wrong algorithmic shape.
2. `demo-submissions/correct-bfs` - full-credit control.
3. `demo-submissions/missing-unreachable-none` - misses the no-path case.
4. `demo-submissions/cycle-timeout-no-visited` - timeout/visited-set failure.
5. `demo-submissions/off-by-one-missing-goal` - endpoint/path construction bug.

## What To Say

PeerReview.ai is not asking Gemini to invent grades. The marks-bearing evidence
comes from deterministic checks: frozen tests, real pytest execution,
misconception rules, graph traces, score clamps, and human approval. Gemini is
used for orchestration and prose polish; the TA keeps both approval gates.

## Failure Handling To Show If Asked

- If the agent is still connecting, buttons stay disabled instead of silently
  dropping the first click.
- Uploads without Python files show an inline error.
- GitHub inputs must be public GitHub repo URLs; invalid or unsupported URLs
  return a readable error.
- Timeouts and runner/import crashes become visible failed test rows instead of
  a misleading `0/0 tests` result.

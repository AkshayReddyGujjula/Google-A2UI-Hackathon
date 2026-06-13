# PeerReview.ai 🪁

**An agentic, evidence-based marking cockpit for CS assignments.** Built for the
**Generative UI Hackathon Track** (CopilotKit + AG-UI). A TA freezes a rubric +
validated test suite, then the agent runs the **real** tests against a student
submission, detects the misconception, draws the traversal, and proposes
evidence-based scores — and **a human approves every final mark.**

> The UI is not a wrapper around the AI. The UI *is* the product: a marking
> workspace the agent generates from the assignment, the repo, the real test
> results, the misconception detected, and the TA's previously-approved feedback.

---

## The problem

Marking programming assignments is slow, inconsistent, and gives students thin
feedback ("-2, see comments"). Pure AI auto-graders are unfair and untrustworthy:
*how do you know the AI's tests are even correct?* PeerReview.ai keeps the human
in control and makes every mark **inspectable and evidence-based**:

- Generated tests must **pass a trusted reference solution** before they can be frozen.
- Graph-search tests assert **path properties, not one exact path** (multiple shortest paths are valid).
- The misconception and the proposed scores are derived from **real test execution**, not model opinion.
- LinkUp reference context is **explanation-only** — it never touches a score.
- Two **human approval gates**: freezing the workspace, and every final mark.

## Track-2 fit — how the required integrations are used

| Integration | Role in PeerReview.ai |
|---|---|
| **CopilotKit + AG-UI** | The live agent↔frontend loop. Two LangGraph agents (`/setup`, `/review`) stream A2UI surfaces over AG-UI; button clicks on a surface are forwarded back to the agent as actions (`approve_workspace`, `approve_grades`, …) — that's the human-in-the-loop mechanism. |
| **A2UI** | The declarative generative UI layer. The agent never emits raw UI code — it composes the marking cockpit from a **controlled catalog** (layout/text/data primitives + PeerReview panels: `VisualGraphTracePanel`, `MisconceptionPanel`, `TestResultsPanel`, `ReferenceContextPanel`, interactive `GradeApprovalPanel`, `CodeBlock`). |
| **LinkUp** | Source-grounded reference context for TA-facing explanations (e.g. *why BFS gives shortest paths*). Shown in `ReferenceContextPanel` with an explicit guardrail badge; **never affects scoring**. |
| **Redis** *(optional)* | Documented production upgrade for checkpointing / caching / calibration memory. The MVP uses local JSON (`agent/data/peerreview/`). |

## The agent workflow

**Phase 1 — Setup (`/setup`)**
`understand_assignment` → `linkup_reference` → `generate_tests` →
**`validate_tests` against a trusted reference solution** (only reference-passing
tests freeze) → **human approval gate** → freeze workspace to disk.

**Phase 2 — Review (`/review`)**
`ingest_submission` (seeded folder / uploaded folder / public GitHub repo) →
**`run_frozen_tests`** (real `pytest`, subprocess + timeout) →
`analyze` misconception (deterministic, from real results + code signals) →
**`graph_trace`** (runs reference BFS + the student's function → expected layers
vs the student's returned path) → `score` (evidence-based, clamped to rubric) →
`calibration` (last 5–10 approved reviews) → **human approval gate** (edit a score
→ feedback regenerates) → `final_feedback` saved to the local archive.

Marks-bearing decisions are **deterministic**; Gemini is used for orchestration
and to polish prose (misconception explanation, feedback letter), with a
templated fallback so the whole flow runs with no API key (`OFFLINE=1`).

## Human-in-the-loop safety

- **Workspace freeze gate** — marking only ever runs against the *frozen, validated* tests.
- **Grade approval gate** — the agent *proposes*; the TA edits scores and approves. Nothing is final without a click.
- **Test validation** — answers "how do you know the tests are right?": they must pass the reference solution.
- **Honest sandbox scope** — the MVP runner is subprocess + hard timeout + captured output, **for controlled demo submissions only**. Docker isolation (no network, CPU/mem limits, read-only test mount) is the documented hardening path before trusting arbitrary public repos — we do **not** claim a secure sandbox.

---

## Run it locally

**Prereqs:** Node 20+, pnpm, Python 3.12 (managed by [uv](https://docs.astral.sh/uv/)), git.

```bash
# 1. Install JS deps
pnpm install

# 2. Create the Python agent venv (Python 3.12)
cd agent && uv sync && cd ..
#   If uv errors picking a Python version, pin it:  uv sync --python 3.12

# 3. Configure keys (optional — see Offline mode below)
cp .env.example .env
#   Edit .env: GEMINI_API_KEY (https://aistudio.google.com/apikey) and,
#   optionally, LINKUP_API_KEY (https://www.linkup.so/)

# 4. Run both servers (Next.js :3000 + FastAPI agent :8123)
pnpm dev
```

Open **http://localhost:3000**.

### Demo walkthrough (the BFS-vs-DFS story)

1. **Setup tab** → click **“Load BFS assignment”**. The agent renders the marking
   workspace: assignment summary, rubric, a LinkUp reference (explanation-only
   guardrail), and a test suite where every test shows **“✓ validated against the
   reference solution.”**
2. Click **“Approve & Freeze Workspace.”** → the rubric + validated tests freeze.
3. **Review tab** → click **“Seeded: DFS submission.”** The agent runs the frozen
   tests **for real**: 6 pass, `test_path_is_minimal` **fails** with the real
   assertion (`path has 5 edges but the shortest is 2`). A `MisconceptionPanel`
   flags *depth-first instead of BFS*, and `VisualGraphTracePanel` draws the BFS
   shortest path (A→F→G, green) vs the student's returned path (A→B→C→D→E→G,
   orange dashed).
4. Edit a score in the **Grade approval** panel, then **“Approve grades & generate
   feedback.”** → the feedback letter + mark breakdown render and save to
   `agent/data/peerreview/feedback/`.

Other submission inputs on the Review tab: **Upload folder…** (pick a folder of
`.py` files) and a **public GitHub repo URL**.

For the live demo, use the ready-made upload folders in `demo-submissions/`.
They cover the headline DFS misconception, a correct BFS solution, a missing
unreachable-case bug, a timeout caused by no visited set, and an endpoint/path
construction bug. See `DEMO.md` for the exact click-through script.

GitHub review accepts public GitHub repository URLs that contain Python files and
define `bfs_shortest_path(graph, start, goal)`. Invalid URLs, private repos,
repos with no `.py` files, and submissions missing the required function are
reported inline instead of producing an empty review.

### Live mode

For the judged demo, `.env` should contain `GEMINI_API_KEY` and should not set
`OFFLINE=1`. Offline mode remains available as the venue-wifi fallback, but the
live path exercises Gemini prose/orchestration plus the same deterministic test
execution and scoring engine.

### Offline mode (no API key — venue-wifi safety net)

Set `OFFLINE=1` in `.env`. The **entire** demo runs with no Gemini/LinkUp calls:
real test execution, misconception detection, the graph trace, scoring,
calibration, and templated feedback all work — only model prose polish is
skipped, and the LinkUp panel shows a clearly-labelled bundled reference.

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | for live mode | Gemini reasoning/prose. Free tier: aistudio.google.com/apikey |
| `LINKUP_API_KEY` | optional | Source-grounded reference lookup (falls back to a bundled reference) |
| `OFFLINE` | optional | `1` = run with no API keys |
| `MODEL` | optional | Gemini model id (default `gemini-3.5-flash`) |
| `REDIS_URL` | optional | Documented production upgrade; unused by the MVP |

## Project structure

```
agent/
  main.py                       FastAPI app — registers /setup and /review (AG-UI)
  src/setup_agent.py            Phase 1 LangGraph agent (build & freeze workspace)
  src/review_agent.py           Phase 2 LangGraph agent (review a submission)
  src/peerreview/
    pipeline.py                 orchestration shared by tools + offline stubs
    test_runner.py              REAL pytest execution + deterministic graph trace
    analysis.py                 misconception detection, scoring, feedback
    linkup.py                   LinkUp reference lookup (+ offline fallback)
    ingest.py                   seeded / pasted / GitHub-repo ingestion
    store.py                    frozen workspaces, calibration, feedback (local JSON)
    surfaces.py                 deterministic A2UI surface builders
    offline.py                  OFFLINE router stub model
src/
  a2ui/catalog/{definitions.ts,renderers.tsx}   A2UI catalog (+ PeerReview panels)
  app/(pdf)/{setup,review}/page.tsx              the two workspace pages
  app/api/copilotkit-agents/route.ts             CopilotKit runtime → agents
fixtures/peerreview/
  assignment-bfs/   brief + rubric + reference_solution.py + tests_reference.py
  submission-dfs/   the seeded (flawed) student submission
  calibration-history/   5 seeded prior approved reviews
```

## Submission checklist

- [x] Public GitHub repo
- [x] Working app (`pnpm dev`)
- [x] Uses CopilotKit + AG-UI, A2UI, and LinkUp
- [ ] Demo video
- [ ] Social media post

## Attribution

Adapted from CopilotKit's **[generative-ui-london-hackathon-starter](https://github.com/jerelvelarde/generative-ui-london-hackathon-starter)**
(Next.js + FastAPI + CopilotKit + AG-UI + A2UI v0.9 + Gemini). PeerReview.ai
replaces the PDF-analyst demo with the marking-cockpit domain, agents, A2UI
panels, and a real test-execution + graph-trace engine. MIT — see [LICENSE](LICENSE).

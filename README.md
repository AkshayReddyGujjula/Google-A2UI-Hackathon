# PeerReview.ai

PeerReview.ai is a human-in-the-loop marking cockpit for programming assignments. A TA creates or imports an assignment, freezes the rubric and deterministic tests, uploads student submissions, and then reviews an agent-generated evidence surface before approving final feedback.

The demo is built for the London A2A & A2UI Hackathon. It showcases why generative UI matters: the agent does not just chat about marking. It renders the right review interface for the submission, including runnable test evidence, graph trace visualisations, an editable diagnosis, an approval gate, and final student feedback.

## Problem

Programming feedback is slow because TAs have to jump between code, tests, rubrics, notes, and student-facing comments. Pure autograders are fast, but they often miss the teaching explanation. Pure LLM feedback is flexible, but it can drift away from the actual marks.

PeerReview.ai combines both:

- deterministic execution decides what passed and failed;
- Gemini helps draft the assignment, diagnosis, and final prose;
- A2UI renders review-specific evidence in the page;
- the TA edits scores and diagnosis before anything is saved as final.

## What The Demo Shows

1. Create an assignment from a brief, pasted text, or uploaded document.
2. Review and manually edit the rubric before freezing it.
3. Upload a student folder, paste code, or add a GitHub repository.
4. Run the review agent against the frozen tests.
5. Inspect the generated marking surface: code, test results, case comparison, optional graph traces, diagnosis, and proposed marks.
6. Edit the diagnosis and scores, then approve.
7. Generate final feedback, copy or download it as text, optionally save as PDF, and move to the next submission.

## Why A2UI Matters

The agent emits declarative A2UI operations rather than raw React code. That gives the demo three useful properties:

- **Controlled UI:** every rendered component comes from the local catalog.
- **Adaptive evidence:** graph assignments get graph trace panels, while general assignments get case comparisons and tables.
- **Actionable surfaces:** approval buttons send structured events back to the agent, so a TA click can trigger final feedback generation.

## Architecture

| Layer | Role |
| --- | --- |
| Next.js 16 + React 19 | The marking app, assignment sidebar, submission queue, A2UI canvas, and Copilot activity rail. |
| CopilotKit + AG-UI | Streams the `review_agent` into the browser and forwards A2UI actions back to the agent. |
| A2UI catalog | Typed components such as `TestResultsPanel`, `VisualGraphTracePanel`, `MisconceptionPanel`, `GradeApprovalPanel`, and `CopyFeedbackPanel`. |
| FastAPI | REST assignment/submission APIs plus the `/review` AG-UI agent endpoint. |
| LangGraph | The review agent orchestration. |
| Local JSON store | Hackathon-friendly persistence for assignments, submissions, reviews, scores, and feedback. |
| Gemini | Drafts assignment structure, diagnosis, and feedback prose. It does not override deterministic test results. |
| LinkUp | Finds further-learning references for explanation only. LinkUp content never affects marks. |

## Deterministic Marking

The app freezes an assignment into:

- an entry function and expected signature;
- a rubric with editable criteria and marks;
- generated or edited test cases;
- a reference solution;
- a comparator such as exact output or unweighted shortest path.

Student submissions are executed against these frozen cases. The score proposal is evidence-based, but the TA can still adjust every score before approval.

## Human-In-The-Loop Gates

PeerReview.ai intentionally keeps the TA in control:

- assignments stay in draft until finalized;
- rubrics and tests can be edited before freezing;
- review surfaces show evidence before feedback is generated;
- diagnosis fields are editable;
- final feedback is generated only after `Approve grades`;
- assignment and submission deletion require confirmation.

## Run Locally

Requirements:

- Node.js and pnpm
- Python with `uv`
- a Gemini API key for live generation
- optional LinkUp credentials for richer learning references

Install and run:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The app runs at [http://localhost:3000](http://localhost:3000). The FastAPI agent runs at [http://localhost:8123](http://localhost:8123).

Environment variables usually live in `.env`:

```bash
GEMINI_API_KEY=...
NEXT_PUBLIC_AGENT_URL=http://localhost:8123
```

Validation:

```bash
pnpm typecheck
pnpm smoke
```

For Python-only syntax checks:

```bash
cd agent
python -m py_compile main.py src/review_agent.py src/peerreview/*.py
```


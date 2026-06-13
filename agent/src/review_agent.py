"""Phase 2 agent — review a student submission against the frozen workspace
(route /review).

Flow:
  1. TA loads a submission (seeded folder, pasted code, or a public GitHub URL)
     -> review_submission tool -> runs the FROZEN tests for real, builds the
        deterministic graph trace, detects the misconception, proposes
        evidence-based scores, and shows the calibration memory + approval gate.
  2. TA edits a score / clicks "Approve grades & generate feedback"
     (A2UI action approve_grades, context carries any edited scores)
     -> finalize_feedback tool -> writes the final feedback + a calibration
        record, and renders the feedback letter + mark breakdown.
  3. Calibration controls: disable_calibration / reset_calibration actions.

Marks-bearing decisions (test pass/fail, misconception, proposed scores) are
deterministic and evidence-based; the model orchestrates and writes prose.
"""
from __future__ import annotations

import json
import os
import re

from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.checkpoint.memory import MemorySaver

from src.catalog import CATALOG_ID
from src.peerreview import pipeline
from src.peerreview.offline import OfflineRouterModel, latest_action


def _emit(result):
    surface_id, components = result
    return a2ui.render(operations=[
        a2ui.create_surface(surface_id, catalog_id=CATALOG_ID),
        a2ui.update_components(surface_id, components),
    ])


@tool
def review_submission(source_type: str = "seeded", seeded_dir: str = "submission-dfs",
                      github_url: str = "", pasted_files_json: str = "") -> str:
    """Review a student submission against the frozen workspace and render the
    review cockpit (real test results, misconception, graph trace, scorecard,
    calibration, approval gate).

    source_type is "seeded" (use seeded_dir, e.g. "submission-dfs" or
    "submission-bfs-correct"), "github" (use github_url, a public repo URL), or
    "pasted" (pasted_files_json: a JSON object of {filename: source}).
    """
    return _emit(pipeline.review_submission(source_type=source_type, seeded_dir=seeded_dir,
                                            github_url=github_url, pasted_files_json=pasted_files_json))


@tool
def finalize_feedback(scores_json: str = "", show_failed_tests: bool = False,
                      include_resource: bool = False) -> str:
    """Generate and save the final student feedback after TA approval.

    If the TA edited any scores in the approval panel, pass them as
    scores_json (a JSON object of {criterion_id: score}); otherwise leave it
    empty to use the proposed scores. show_failed_tests includes the failing
    tests in the student-facing feedback; include_resource adds the LinkUp
    learning resource.
    """
    return _emit(pipeline.finalize_feedback(scores_json=scores_json,
                                            show_failed_tests=show_failed_tests,
                                            include_resource=include_resource))


@tool
def manage_calibration(action: str = "reset") -> str:
    """Manage assignment calibration memory. action="reset" clears TA-approved
    records (seeded history is kept); action="disable" turns calibration off and
    re-renders the current review without it."""
    if action == "disable":
        pipeline.set_calibration_enabled(False)
        return _emit(pipeline.review_submission(source_type="seeded", seeded_dir="submission-dfs"))
    n = pipeline.reset_calibration_memory()
    return json.dumps({"reset_records": n})


SYSTEM_PROMPT = """\
You are PeerReview.ai's review assistant. You help a TA mark a student
submission against a FROZEN workspace, keeping a human in the loop.

How a turn works:
- When the TA asks to review a submission, call `review_submission`:
  - seeded sample: source_type="seeded", seeded_dir="submission-dfs"
  - a public GitHub repo: source_type="github", github_url=<the URL they gave>
  - pasted code: source_type="pasted", pasted_files_json={"solution.py": "..."}
  The rendered cockpit IS the answer — do not describe it in prose.
- When you receive the A2UI action "approve_grades" (a log_a2ui_event), read its
  Context: if it contains a `scores` object, pass it as scores_json to
  `finalize_feedback`; pass show_failed_tests / include_resource if present.
- If the TA asks in chat to change a score (e.g. "set correctness to 3"),
  call `finalize_feedback` with scores_json reflecting that edit.
- Actions "disable_calibration" -> manage_calibration(action="disable");
  "reset_calibration" -> manage_calibration(action="reset").

Hard rules:
- Call at most ONE tool per turn. After it returns, reply with one short
  sentence or empty. Never echo tool output or surface JSON.
- Never override the deterministic test results or invent evidence.
"""

_TOOLS = [review_submission, finalize_feedback, manage_calibration]
_TOOL_NAMES = ("review_submission", "finalize_feedback", "manage_calibration")


def _route(messages):
    action = latest_action(messages)
    if action == "approve_grades":
        # Try to recover edited scores from the event content.
        scores = ""
        for m in reversed(messages):
            mt = re.search(r'"scores"\s*:\s*(\{[^}]*\})', str(getattr(m, "content", "")))
            if mt:
                scores = mt.group(1)
                break
        return ("finalize_feedback", {"scores_json": scores})
    if action == "reset_calibration":
        return ("manage_calibration", {"action": "reset"})
    if action == "disable_calibration":
        return ("manage_calibration", {"action": "disable"})
    return ("review_submission", {"source_type": "seeded", "seeded_dir": "submission-dfs"})


def _build_model():
    return ChatGoogleGenerativeAI(model=os.getenv("MODEL", "gemini-3.5-flash"),
                                  google_api_key=os.getenv("GEMINI_API_KEY"), temperature=0)


class _LazyModel:
    _m = None

    def _get(self):
        if _LazyModel._m is None:
            _LazyModel._m = _build_model()
        return _LazyModel._m

    @property
    def profile(self):
        return self._get().profile

    def bind_tools(self, *a, **k):
        return self._get().bind_tools(*a, **k)

    def bind(self, *a, **k):
        return self._get().bind(*a, **k)

    def __getattr__(self, name):
        return getattr(self._get(), name)


def build_review_agent():
    if os.getenv("OFFLINE") == "1":
        model = OfflineRouterModel(router=_route, tool_names=_TOOL_NAMES,
                                   final_text="Review cockpit rendered (offline).")
        return create_agent(model=model, tools=_TOOLS, system_prompt=SYSTEM_PROMPT, checkpointer=MemorySaver())
    return create_agent(model=_LazyModel(), tools=_TOOLS, middleware=[CopilotKitMiddleware()],
                        system_prompt=SYSTEM_PROMPT, checkpointer=MemorySaver())


graph = build_review_agent()

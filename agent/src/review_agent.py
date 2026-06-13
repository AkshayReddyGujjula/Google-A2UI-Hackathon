"""Review agent (route /review) — the CopilotKit + AG-UI + A2UI showcase.

The frontend (no chatbox; headless) asks this agent to review a stored submission
or to finalize after the TA approves. The agent renders the adaptive A2UI cockpit
and feedback surface. Marks-bearing work is deterministic in pipeline/test_runner;
Gemini orchestrates the turn and writes prose.
"""
from __future__ import annotations

import re

from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import tool
from langgraph.checkpoint.memory import MemorySaver

from src.catalog import CATALOG_ID
from src.peerreview import model, pipeline


def _emit(result):
    surface_id, components = result
    return a2ui.render(operations=[
        a2ui.create_surface(surface_id, catalog_id=CATALOG_ID),
        a2ui.update_components(surface_id, components),
    ])


@tool
def review_submission(workspace_id: str, submission_id: str) -> str:
    """Mark a stored student submission against its frozen assignment workspace.
    Runs the real differential tests, builds the evidence + adaptive visuals, and
    proposes evidence-based scores. Pass the workspace_id and submission_id given
    in the request."""
    return _emit(pipeline.review_submission(workspace_id=workspace_id, submission_id=submission_id))


@tool
def finalize_feedback(scores_json: str = "", show_failed_tests: bool = False,
                      include_resource: bool = False) -> str:
    """Generate + save the final feedback after the TA approves. If the TA edited
    scores in the approval panel, pass them as scores_json ({criterion_id: score});
    otherwise leave empty to use the proposed scores."""
    return _emit(pipeline.finalize_feedback(scores_json=scores_json,
                                            show_failed_tests=show_failed_tests,
                                            include_resource=include_resource))


SYSTEM_PROMPT = """\
You are PeerReview.ai's marking assistant. Keep a human in the loop.

How a turn works:
- To mark a submission, call `review_submission(workspace_id, submission_id)` with the
  ids given in the request. The rendered cockpit IS the answer — do not describe it.
- When you receive the A2UI action "approve_grades" (a log_a2ui_event), read its Context:
  if it has a `scores` object, pass it as scores_json to `finalize_feedback`; pass
  show_failed_tests / include_resource if present.

Hard rules:
- Call at most ONE tool per turn. After it returns, reply with one short sentence or empty.
- Never echo tool output or surface JSON. Never override the deterministic results.
"""

_TOOLS = [review_submission, finalize_feedback]


class _LazyModel:
    """Defer Gemini construction to first use so `import main` works with no key."""
    _m = None

    def _get(self):
        if _LazyModel._m is None:
            _LazyModel._m = model.build_chat_model(temperature=0)
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
    return create_agent(model=_LazyModel(), tools=_TOOLS, middleware=[CopilotKitMiddleware()],
                        system_prompt=SYSTEM_PROMPT, checkpointer=MemorySaver())


graph = build_review_agent()

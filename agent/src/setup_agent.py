"""Phase 1 agent — build & freeze a marking workspace (route /setup).

Flow the agent drives:
  1. TA loads an assignment  -> setup_workspace tool  -> emits the setup surface
     (assignment summary, rubric, LinkUp reference, validated test suite,
      approval gate).
  2. TA clicks "Approve & Freeze Workspace" (A2UI action approve_workspace)
                              -> freeze_workspace tool -> freezes to disk.
  3. TA clicks "Regenerate tests" (regenerate_tests)   -> setup_workspace again.

The marks-bearing work (validating generated tests against a trusted reference
solution) is deterministic in pipeline/test_runner — the model only orchestrates.
"""
from __future__ import annotations

import os

from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.checkpoint.memory import MemorySaver

from src.catalog import CATALOG_ID
from src.peerreview import pipeline
from src.peerreview.offline import OfflineRouterModel, latest_action


def _emit(result: tuple[str, list[dict]]) -> str:
    surface_id, components = result
    return a2ui.render(operations=[
        a2ui.create_surface(surface_id, catalog_id=CATALOG_ID),
        a2ui.update_components(surface_id, components),
    ])


@tool
def setup_workspace(assignment_dir: str = "assignment-bfs", pasted_rubric_json: str = "") -> str:
    """Build the marking workspace for an assignment and render it as a surface.

    Use the seeded assignment by passing assignment_dir (default
    "assignment-bfs"), or pass a structured rubric as pasted_rubric_json. This
    parses the rubric, fetches LinkUp reference context, and validates the test
    suite against the reference solution before showing the approval gate.
    """
    return _emit(pipeline.setup_workspace(assignment_dir=assignment_dir, pasted_rubric_json=pasted_rubric_json))


@tool
def freeze_workspace() -> str:
    """Freeze the most recently built workspace (rubric + validated tests) to
    disk. Call this when the TA approves the workspace (approve_workspace)."""
    return _emit(pipeline.freeze_workspace())


SYSTEM_PROMPT = """\
You are PeerReview.ai's setup assistant. You help a TA turn a programming
assignment into a frozen marking workspace, with human approval.

How a turn works:
- When the TA asks to set up / load / build a workspace for an assignment,
  call `setup_workspace` (use the default seeded assignment unless the TA
  pasted a rubric). The rendered surface is the answer — do not describe it.
- When you receive an A2UI action event "approve_workspace" (delivered as a
  log_a2ui_event tool result), call `freeze_workspace`.
- When you receive the action "regenerate_tests", call `setup_workspace` again.

Hard rules:
- Call at most ONE tool per turn. After the tool returns, reply with a single
  short sentence (or empty). Never echo tool output or the surface JSON.
- Never invent scores; setup only structures the rubric and validates tests.
"""

_TOOLS = [setup_workspace, freeze_workspace]
_TOOL_NAMES = ("setup_workspace", "freeze_workspace")


def _route(messages):
    action = latest_action(messages)
    if action == "approve_workspace":
        return ("freeze_workspace", {})
    if action == "regenerate_tests":
        return ("setup_workspace", {"assignment_dir": "assignment-bfs"})
    # First user turn: build the workspace.
    return ("setup_workspace", {"assignment_dir": "assignment-bfs"})


def _build_model():
    return ChatGoogleGenerativeAI(model=os.getenv("MODEL", "gemini-3.5-flash"),
                                  google_api_key=os.getenv("GEMINI_API_KEY"), temperature=0)


def build_setup_agent():
    if os.getenv("OFFLINE") == "1":
        model = OfflineRouterModel(router=_route, tool_names=_TOOL_NAMES,
                                   final_text="Workspace surface rendered (offline).")
        return create_agent(model=model, tools=_TOOLS, system_prompt=SYSTEM_PROMPT, checkpointer=MemorySaver())
    return create_agent(model=_LazyModel(), tools=_TOOLS, middleware=[CopilotKitMiddleware()],
                        system_prompt=SYSTEM_PROMPT, checkpointer=MemorySaver())


class _LazyModel:
    """Defer Gemini construction to first use so `import main` works with no key."""
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


graph = build_setup_agent()

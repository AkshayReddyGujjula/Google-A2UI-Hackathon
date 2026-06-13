"""OFFLINE=1 stub model — runs the real create_agent loop + real tools with NO
Gemini call, so PeerReview.ai demos on venue wifi without an API key. A small
deterministic router decides which tool to call from the message history,
mirroring what the online model would choose from the system prompt.
"""
from __future__ import annotations

import re
import uuid
from typing import Any, Callable

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult


def latest_action(messages: list[BaseMessage]) -> str | None:
    """The A2UI action name to act on THIS turn, or None.

    Only returns an action if a log_a2ui_event is the most recent trigger — i.e.
    it appears AFTER the last human message. Otherwise a freshly typed/sent
    command (a HumanMessage) takes precedence, so re-running setup/review on a
    thread that already contains an older action doesn't replay that action.
    """
    from langchain_core.messages import HumanMessage

    for m in reversed(messages):
        if isinstance(m, ToolMessage) and "action" in str(m.content):
            mt = re.search(r'action "([^"]+)"', str(m.content))
            if mt:
                return mt.group(1)
        if isinstance(m, HumanMessage):
            return None
    return None


def last_is_our_tool(messages: list[BaseMessage], tool_names: set[str]) -> bool:
    for m in reversed(messages):
        if isinstance(m, ToolMessage):
            return getattr(m, "name", None) in tool_names
        if isinstance(m, AIMessage):
            continue
        break
    return False


class OfflineRouterModel(BaseChatModel):
    """Drives the agent deterministically. `router(messages)` returns either
    ("tool_name", args_dict) to emit a forced tool call, or None to finish."""

    router: Callable[[list[BaseMessage]], tuple[str, dict] | None]
    final_text: str = "Done."
    tool_names: tuple[str, ...] = ()

    @property
    def _llm_type(self) -> str:
        return "peerreview-offline-router"

    def bind_tools(self, tools: Any, **kwargs: Any) -> "OfflineRouterModel":
        return self

    def bind(self, **kwargs: Any) -> "OfflineRouterModel":
        return self

    def _generate(self, messages: list[BaseMessage], stop: list[str] | None = None,
                  run_manager: Any | None = None, **kwargs: Any) -> ChatResult:
        # If the last message is one of our own tool results, the turn is done.
        if last_is_our_tool(messages, set(self.tool_names)):
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content=self.final_text))])
        decision = self.router(messages)
        if decision is None:
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content=self.final_text))])
        name, args = decision
        msg = AIMessage(content="", tool_calls=[{"name": name, "args": dict(args), "id": f"call_{uuid.uuid4().hex[:12]}"}])
        return ChatResult(generations=[ChatGeneration(message=msg)])

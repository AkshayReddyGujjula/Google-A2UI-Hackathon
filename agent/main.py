"""FastAPI server exposing the PeerReview.ai AG-UI agents:

  POST /setup/   — Phase 1: build & freeze a marking workspace (setup_agent)
  POST /review/  — Phase 2: review a student submission (review_agent)

Run with:  uvicorn main:app --port 8123 --reload
"""
from __future__ import annotations

import os
from pathlib import Path

import uvicorn
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import LangGraphAGUIAgent
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load env from agent/.env (preferred) and fall back to the repo-root .env so a
# TA can keep keys in either place.
load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from src.review_agent import graph as review_graph  # noqa: E402
from src.setup_agent import graph as setup_graph  # noqa: E402

app = FastAPI(title="PeerReview.ai Agents")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ag_ui_langgraph builds its own RunnableConfig per run; pass recursion_limit
# here so it's honored (our flows are short — one tool per turn).
_AGENT_CONFIG = {"recursion_limit": 50}

add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="setup_agent",
        description="PeerReview.ai — build & freeze a marking workspace (Phase 1).",
        graph=setup_graph,
        config=_AGENT_CONFIG,
    ),
    path="/setup",
)

add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="review_agent",
        description="PeerReview.ai — review a student submission (Phase 2).",
        graph=review_graph,
        config=_AGENT_CONFIG,
    ),
    path="/review",
)


@app.get("/")
def root():
    return {"ok": True, "agents": {"setup_agent": "/setup/", "review_agent": "/review/"}}


def main():
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8123")), reload=True)


if __name__ == "__main__":
    main()

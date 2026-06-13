"""FastAPI server for PeerReview.ai.

  AG-UI:  POST /review/                  — the CopilotKit/AG-UI/A2UI marking agent
  REST:   /api/assignments(...)          — create/generate/edit/freeze workspaces
          /api/assignments/{id}/submissions — add/list student submissions

Run with:  uvicorn main:app --port 8123 --reload
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

import uvicorn
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import LangGraphAGUIAgent
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from src.peerreview import generation, model, pipeline, store  # noqa: E402
from src.review_agent import graph as review_graph  # noqa: E402

log = logging.getLogger("peerreview")
app = FastAPI(title="PeerReview.ai")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(name="review_agent",
                             description="PeerReview.ai marking agent (review + feedback).",
                             graph=review_graph, config={"recursion_limit": 50}),
    path="/review",
)


@app.get("/")
def root():
    return {"ok": True, "model": model.model_status(), "agents": {"review_agent": "/review/"}}


# ── assignments (workspaces) ──────────────────────────────────────────────────────
@app.get("/api/assignments")
def list_assignments():
    return {"assignments": store.list_workspaces()}


@app.post("/api/assignments")
async def create_assignment(request: Request):
    body = await request.json()
    doc_text = (body.get("doc_text") or "").strip()
    if not doc_text:
        raise HTTPException(400, "doc_text is required (the assessment document text).")
    result = pipeline.generate_assignment(doc_text, body.get("rubric_text", ""))
    if not result.get("supported", True):
        raise HTTPException(422, result.get("message", "Unsupported assignment."))
    return result


@app.get("/api/assignments/{wid}")
def get_assignment(wid: str):
    ws = store.get_workspace(wid)
    if not ws:
        raise HTTPException(404, "assignment not found")
    return ws


@app.patch("/api/assignments/{wid}")
async def patch_assignment(wid: str, request: Request):
    patch = await request.json()
    allowed = {k: patch[k] for k in ("title", "rubric", "tests") if k in patch}
    ws = store.update_workspace(wid, allowed)
    if not ws:
        raise HTTPException(404, "assignment not found")
    return ws


@app.post("/api/assignments/{wid}/freeze")
def freeze_assignment(wid: str):
    ws = store.freeze_workspace(wid)
    if not ws:
        raise HTTPException(404, "assignment not found")
    return ws


@app.post("/api/assignments/{wid}/regenerate-tests")
def regenerate_tests(wid: str):
    ws = store.get_workspace(wid)
    if not ws:
        raise HTTPException(404, "assignment not found")
    fresh = generation.build_assignment(ws.get("doc_text", ""), "")
    if not fresh.get("supported", True):
        raise HTTPException(422, "could not regenerate tests")
    return store.update_workspace(wid, {
        "comparator": fresh.get("comparator", ws.get("comparator")),
        "cases": fresh.get("cases", []), "tests": fresh.get("tests", []),
        "reference_solution": fresh.get("reference_solution", ws.get("reference_solution")),
    })


@app.delete("/api/assignments/{wid}")
def delete_assignment(wid: str):
    return {"deleted": store.delete_workspace(wid)}


# ── submissions ─────────────────────────────────────────────────────────────────
@app.get("/api/assignments/{wid}/submissions")
def list_subs(wid: str):
    if not store.get_workspace(wid):
        raise HTTPException(404, "assignment not found")
    return {"submissions": store.list_submissions(wid)}


@app.post("/api/assignments/{wid}/submissions")
async def add_sub(wid: str, request: Request):
    if not store.get_workspace(wid):
        raise HTTPException(404, "assignment not found")
    body = await request.json()
    source_type = body.get("source_type", "pasted")
    ing = pipeline.resolve_submission_files(
        source_type, github_url=body.get("github_url", ""),
        pasted_files_json=body.get("pasted_files_json", ""))
    if not ing.get("ok"):
        raise HTTPException(400, ing.get("error", "could not read submission"))
    rec = store.add_submission(wid, {
        "name": body.get("name") or ing.get("source", "submission"),
        "source": ing.get("source", source_type), "files": ing["files"],
    })
    return {"id": rec["id"], "name": rec["name"], "source": rec["source"], "status": rec["status"]}


@app.get("/api/assignments/{wid}/submissions/{sid}")
def get_sub(wid: str, sid: str):
    sub = store.get_submission(wid, sid)
    if not sub:
        raise HTTPException(404, "submission not found")
    return sub


def main():
    log.info("PeerReview.ai model: %s", model.model_status())
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8123")), reload=True)


if __name__ == "__main__":
    main()

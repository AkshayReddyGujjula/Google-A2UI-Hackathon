"""Orchestration.

Phase 1 (generation + CRUD) is called from the FastAPI REST layer:
  generate_assignment / resolve_submission_files.
Phase 2 (review + feedback) is called from the review_agent tools and returns
A2UI (surface_id, components) so the agent can render the cockpit over AG-UI.
"""
from __future__ import annotations

import json
from typing import Any

from . import analysis, generation, ingest, linkup, store, surfaces, test_runner

# Process-local cache for the in-flight review (one submission marked at a time).
_STATE: dict[str, Any] = {"review": None}


# ── Phase 1: generation + ingestion (REST) ────────────────────────────────────────
def generate_assignment(doc_text: str, rubric_text: str = "") -> dict[str, Any]:
    """Generate a draft assignment workspace from an uploaded doc and persist it."""
    spec = generation.build_assignment(doc_text, rubric_text)
    if not spec.get("supported", True):
        return {"supported": False, "title": spec.get("title", "Unsupported"),
                "message": spec.get("message", "")}
    # LinkUp reference context (explanation-only; never affects scoring)
    spec["reference"] = linkup.reference_lookup(spec.get("title", "assignment concepts"))
    spec["doc_text"] = doc_text[:8000]
    return store.create_workspace(spec)


def resolve_submission_files(source_type: str, github_url: str = "",
                             pasted_files_json: str = "") -> dict[str, Any]:
    """Turn an upload into a {filename: source} map (called when a submission is added)."""
    if source_type == "github":
        return ingest.ingest_github(github_url)
    return ingest.ingest_pasted(json.loads(pasted_files_json) if pasted_files_json else {})


# ── Phase 2: review + feedback (AG-UI surfaces) ───────────────────────────────────
def _warn(surface: str, title: str, body: str) -> tuple[str, list[dict]]:
    return surface, [{"id": "root", "component": "Callout", "tone": "warning", "title": title, "body": body}]


def review_submission(workspace_id: str, submission_id: str) -> tuple[str, list[dict]]:
    ws = store.get_workspace(workspace_id)
    if not ws:
        return _warn(surfaces.REVIEW_SURFACE, "Workspace not found", "Create and finalize an assignment first.")
    if ws.get("status") != "frozen":
        return _warn(surfaces.REVIEW_SURFACE, "Workspace not finalized", "Finalize the assignment before marking submissions.")
    sub = store.get_submission(workspace_id, submission_id)
    if not sub:
        return _warn(surfaces.REVIEW_SURFACE, "Submission not found", "Add the submission again.")

    files = sub.get("files", {})
    entry_func = ws.get("entry_function", "")
    loc = ingest.locate_entry(files, entry_func)
    if not loc:
        store.update_submission(workspace_id, submission_id, {"status": "error"})
        return _warn(surfaces.REVIEW_SURFACE, "Required function not found",
                     f"No file defines `{entry_func}(...)` in this submission.")

    selected = {t["name"] for t in ws.get("tests", []) if t.get("selected", True)}
    cases = [c for c in ws.get("cases", []) if not selected or c["name"] in selected]

    diff = test_runner.run_diff_tests(ws.get("reference_solution", ""), files, loc["entry_module"],
                                      entry_func, cases, ws.get("comparator", "exact"))
    entry_code = files.get(loc["entry_file"], "")

    misconception = analysis.detect_misconception(diff, entry_code, ws)
    scorecard = analysis.propose_scores(ws.get("rubric", {}), diff, entry_code, misconception)
    proposed_total = sum(c["proposed"] for c in scorecard)
    max_total = sum(c["max"] for c in scorecard)

    trace = None
    if ws.get("comparator") == "shortest_path_unweighted":
        graph_cases = [c for c in diff.get("cases", [])
                       if isinstance(c.get("input"), list) and c["input"]
                       and isinstance(c["input"][0], dict) and isinstance(c.get("expected"), list)]
        traces = []
        for c in graph_cases:
            built = test_runner.build_trace_from_case(c["input"], c.get("expected"), c.get("actual"))
            if built:
                built.update({
                    "case_name": c.get("name", "case"),
                    "case_status": c.get("status", ""),
                    "case_message": c.get("message", ""),
                })
                traces.append(built)
        if traces:
            traces.sort(key=lambda t: 0 if t.get("case_status") != "passed" else 1)
            trace = {"traces": traces, **traces[0]}

    calibration = store.summarize_calibration(store.load_calibration_history(workspace_id))

    review = {
        "workspace_id": workspace_id, "submission_id": submission_id,
        "assignment_title": ws.get("title", ""), "assignment_type": ws.get("assignment_type", "general"),
        "submission_name": sub.get("name", submission_id), "source": sub.get("source", ""),
        "repo": {"file_count": len(files), "entry_file": loc["entry_file"], "entry_func": entry_func},
        "entry_code": entry_code, "diff": diff, "misconception": misconception, "trace": trace,
        "scorecard": scorecard, "proposed_total": proposed_total, "max_total": max_total,
        "calibration": calibration, "rubric": ws.get("rubric", {}), "reference": ws.get("reference"),
        "spec": ws,
    }
    _STATE["review"] = review
    store.update_submission(workspace_id, submission_id, {
        "status": "reviewed",
        "proposed_scores": {c["id"]: c["proposed"] for c in scorecard},
        "total": proposed_total, "max_total": max_total,
    })
    return surfaces.REVIEW_SURFACE, surfaces.build_review_surface(review)


def finalize_feedback(workspace_id: str = "", submission_id: str = "", scores_json: str = "",
                      show_failed_tests: bool = False, include_resource: bool = False) -> tuple[str, list[dict]]:
    review = _STATE.get("review")
    if not review or (workspace_id and review.get("workspace_id") != workspace_id):
        return _warn(surfaces.FINAL_SURFACE, "Nothing to finalize", "Review a submission first.")
    wid, sid = review["workspace_id"], review["submission_id"]

    scorecard = [dict(c) for c in review["scorecard"]]
    if scores_json.strip():
        try:
            overrides = json.loads(scores_json)
            for c in scorecard:
                if c["id"] in overrides:
                    c["proposed"] = max(0, min(c["max"], int(overrides[c["id"]])))
        except (json.JSONDecodeError, ValueError, TypeError):
            pass
    total = sum(c["proposed"] for c in scorecard)
    max_total = sum(c["max"] for c in scorecard)
    misconception = review["misconception"]

    fb = analysis.build_feedback(review["spec"], scorecard, misconception, review.get("reference"),
                                 include_resource, total, max_total)
    failed = [c for c in review["diff"].get("cases", []) if c["status"] != "passed"]
    grade = "Distinction" if max_total and total / max_total >= 0.85 else \
            "Pass" if max_total and total / max_total >= 0.5 else "Needs work"

    store.update_submission(wid, sid, {
        "status": "approved",
        "scores": {c["id"]: c["proposed"] for c in scorecard},
        "total": total, "max_total": max_total,
        "misconception_labels": [misconception["label"]] if misconception.get("detected") and misconception.get("label") else [],
        "feedback": fb["plain_text"], "show_failed_tests": show_failed_tests,
    })

    final = {
        "greeting": fb["greeting"], "letter_paragraphs": fb["letter_paragraphs"],
        "plain_text": fb["plain_text"],
        "breakdown": [{"label": c["label"], "score": c["proposed"], "max": c["max"]} for c in scorecard],
        "total": total, "max_total": max_total, "grade_caption": grade,
        "submission_name": review.get("submission_name", ""),
        "show_failed_tests": show_failed_tests, "failed_tests": failed,
    }
    return surfaces.FINAL_SURFACE, surfaces.build_final_surface(final)

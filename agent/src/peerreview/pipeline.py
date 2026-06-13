"""High-level orchestration shared by the setup and review agents (and the
OFFLINE stubs). Each function returns (surface_id, components) so the calling
tool can wrap them in a2ui operations. Cross-step state for the approve gates is
held in a small process-local cache; cross-AGENT state (a frozen workspace) goes
through `store` on disk, so the review agent picks up what the setup agent froze.
"""
from __future__ import annotations

import json
import re
from typing import Any

from . import analysis, ingest, linkup, store, surfaces, test_runner

# Process-local cache for the in-flight setup draft and review (single active
# workspace per demo session). Frozen workspaces persist to disk via `store`.
_STATE: dict[str, Any] = {"draft": None, "review": None, "calibration_enabled": True}

# Human-readable descriptions for the canonical BFS test names.
_TEST_CHECKS = {
    "test_start_equals_goal": "start == goal returns [start]",
    "test_unreachable_returns_none": "unreachable goal returns None",
    "test_path_endpoints": "path starts at start, ends at goal",
    "test_path_edges_exist": "every step is a real edge",
    "test_path_is_minimal": "path length is minimal (BFS distance)",
    "test_accepts_any_valid_shortest_path": "accepts any valid shortest path",
    "test_handles_cycle_terminates": "terminates on cyclic graphs",
}


def _checks_for(name: str) -> str:
    return _TEST_CHECKS.get(name, name.replace("test_", "").replace("_", " "))


def _assignment_summary(brief: str, rubric: dict) -> str:
    """A clean one/two-sentence summary for the assignment card (no markdown)."""
    if brief:
        # Prefer the sentence(s) under a "## Task" heading; strip markdown.
        m = re.search(r"#+\s*Task\s*\n+(.+?)(?:\n#|\Z)", brief, re.S | re.I)
        text = m.group(1) if m else brief
        text = re.sub(r"```.*?```", "", text, flags=re.S)
        text = re.sub(r"[*`#>_]", "", text)
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            sentences = re.split(r"(?<=[.])\s+", text)
            return " ".join(sentences[:2]).strip()
    return rubric.get("title", "")


# ── Phase 1: setup ───────────────────────────────────────────────────────────────
def setup_workspace(assignment_dir: str = "assignment-bfs", pasted_rubric_json: str = "") -> tuple[str, list[dict]]:
    if pasted_rubric_json.strip():
        rubric = json.loads(pasted_rubric_json)
        fixture = {"rubric": rubric, "brief": "", "reference_solution": "", "tests_source": ""}
    else:
        fixture = store.load_assignment_fixture(assignment_dir)
        rubric = fixture["rubric"]

    ep = rubric.get("entry_point", {})
    entry_func = ep.get("function", "bfs_shortest_path")

    # LinkUp reference (explanation context only; never affects scoring)
    topic = (
        "Why breadth-first search finds shortest paths in unweighted graphs"
        if rubric.get("assignment_type") == "graph_search"
        else rubric.get("title", "assignment concepts")
    )
    reference = linkup.reference_lookup(topic)

    # Validate the (generated/bundled) tests against the trusted reference solution
    tests_source = fixture["tests_source"]
    validation: dict[str, Any] = {"valid": False, "message": "No reference solution available to validate tests."}
    if fixture["reference_solution"] and tests_source:
        v = test_runner.validate_tests_against_reference(
            fixture["reference_solution"], tests_source, entry_func, exported_name=entry_func
        )
        if v["valid"]:
            n = v["summary"]["total"]
            validation = {"valid": True, "message": f"All {n} tests pass against the reference solution — safe to freeze.", "results": v["results"]}
        else:
            validation = {"valid": False, "message": f"Rejected invalid tests (reference failed): {', '.join(v['invalid'])}.", "results": v.get("results", [])}

    # Test preview from validated test names
    preview = [{"name": r["name"], "checks": _checks_for(r["name"])} for r in validation.get("results", []) if r["status"] == "passed"]

    summary = _assignment_summary(fixture["brief"], rubric)

    draft = {
        "assignment_id": rubric.get("assignment_id"),
        "rubric": rubric,
        "summary": summary,
        "reference": reference,
        "validation": validation,
        "test_preview": preview,
        "tests_source": tests_source,
        "reference_solution": fixture["reference_solution"],
        "entry_func": entry_func,
        "entry_module_hint": ep.get("module_hint", "solution"),
        "trace_graph": test_runner.SAMPLE_GRAPH,
        "trace_start": test_runner.SAMPLE_START,
        "trace_goal": test_runner.SAMPLE_GOAL,
        "include_resource": False,
    }
    _STATE["draft"] = draft
    return surfaces.SETUP_SURFACE, surfaces.build_setup_surface(draft)


def freeze_workspace() -> tuple[str, list[dict]]:
    draft = _STATE.get("draft")
    if not draft:
        return surfaces.SETUP_SURFACE, surfaces.build_frozen_confirmation({"workspace_id": "(none)", "assignment_id": "set up a workspace first"})
    ws = store.freeze_workspace({
        "assignment_id": draft["assignment_id"],
        "rubric": draft["rubric"],
        "frozen_tests_source": draft["tests_source"],
        "reference_solution": draft["reference_solution"],
        "entry_func": draft["entry_func"],
        "entry_module_hint": draft["entry_module_hint"],
        "trace_graph": draft["trace_graph"],
        "trace_start": draft["trace_start"],
        "trace_goal": draft["trace_goal"],
        "reference": draft["reference"],
        "frozen_tests_preview": draft["test_preview"],
    })
    return surfaces.FINAL_SURFACE, surfaces.build_frozen_confirmation(ws)


# ── Phase 2: review ────────────────────────────────────────────────────────────--
def review_submission(source_type: str, seeded_dir: str = "", github_url: str = "", pasted_files_json: str = "") -> tuple[str, list[dict]]:
    ws = store.latest_workspace()
    if not ws:
        return surfaces.REVIEW_SURFACE, [{"id": "root", "component": "Callout", "tone": "warning",
                                          "title": "No frozen workspace", "body": "Set up and approve a workspace on the Setup tab first."}]

    # 1. Ingest
    if source_type == "github":
        ing = ingest.ingest_github(github_url)
    elif source_type == "pasted":
        ing = ingest.ingest_pasted(json.loads(pasted_files_json) if pasted_files_json else {})
    else:
        ing = ingest.ingest_seeded(seeded_dir or "submission-dfs")
    if not ing["ok"]:
        return surfaces.REVIEW_SURFACE, [{"id": "root", "component": "Callout", "tone": "warning",
                                          "title": "Could not load submission", "body": ing["error"]}]
    files = ing["files"]

    # 2. Locate entry point
    entry_func = ws["entry_func"]
    loc = ingest.locate_entry(files, entry_func)
    if not loc:
        return surfaces.REVIEW_SURFACE, [{"id": "root", "component": "Callout", "tone": "warning",
                                          "title": "Entry function not found",
                                          "body": f"No file defines `{entry_func}(...)` in {ing['source']}."}]

    # 3. Run the frozen tests (real execution)
    test_results = test_runner.run_pytest(
        files, ws["frozen_tests_source"], loc["entry_module"], entry_func, exported_name=entry_func
    )
    test_results.setdefault("summary", {"total": 0, "passed": 0, "failed": 0})
    if not test_results.get("ok") and test_results.get("timed_out"):
        test_results["timed_out"] = True

    # 4. Deterministic graph trace
    trace = test_runner.build_graph_trace(
        files, loc["entry_module"], entry_func, ws.get("trace_graph"), ws.get("trace_start"), ws.get("trace_goal")
    )

    entry_code = files[loc["entry_file"]]

    # 5. Misconception + 6. scores (deterministic, evidence-based)
    misconception = analysis.detect_misconception(test_results, entry_code)
    scorecard = analysis.propose_scores(ws["rubric"], test_results, misconception, entry_code)
    proposed_total = sum(c["proposed"] for c in scorecard)
    max_total = sum(c["max"] for c in scorecard)

    # 7. Calibration (advisory)
    calibration = {}
    if _STATE.get("calibration_enabled", True):
        calibration = store.summarize_calibration(store.load_calibration_history(ws["assignment_id"]))

    review = {
        "assignment_title": ws["rubric"].get("title", ""),
        "assignment_id": ws["assignment_id"],
        "source": ing["source"],
        "repo": {"file_count": len(files), "entry_file": loc["entry_file"], "entry_func": entry_func},
        "entry_code": entry_code,
        "test_results": test_results,
        "misconception": misconception,
        "trace": trace,
        "scorecard": scorecard,
        "proposed_total": proposed_total,
        "max_total": max_total,
        "calibration": calibration,
        "rubric": ws["rubric"],
        "reference": ws.get("reference"),
        "include_resource": False,
    }
    _STATE["review"] = review
    return surfaces.REVIEW_SURFACE, surfaces.build_review_surface(review)


def finalize_feedback(scores_json: str = "", show_failed_tests: bool = False, include_resource: bool = False) -> tuple[str, list[dict]]:
    review = _STATE.get("review")
    if not review:
        return surfaces.FINAL_SURFACE, [{"id": "root", "component": "Callout", "tone": "warning",
                                         "title": "Nothing to finalize", "body": "Run a submission review first."}]

    scorecard = [dict(c) for c in review["scorecard"]]
    # Apply TA edits (clamped to each criterion's max)
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

    fb = analysis.build_feedback(review["rubric"], scorecard, misconception, review.get("reference"),
                                 include_resource, total, max_total)

    failed_tests = [t for t in review["test_results"].get("tests", []) if t["status"] != "passed"]
    grade_caption = "Distinction" if total / max_total >= 0.85 else "Pass" if total / max_total >= 0.5 else "Needs work"

    # Persist final feedback + a calibration record of what the TA approved
    saved = store.save_feedback({
        "assignment_id": review["assignment_id"],
        "source": review["source"],
        "scores": {c["id"]: c["proposed"] for c in scorecard},
        "total": total,
        "max_total": max_total,
        "misconception_labels": [misconception["label"]] if misconception.get("detected") and misconception.get("label") else [],
        "feedback": fb["plain_text"],
        "show_failed_tests": show_failed_tests,
    })
    store.save_calibration_record({
        "assignment_id": review["assignment_id"],
        "workspace_version": "v1",
        "scores": {c["id"]: c["proposed"] for c in scorecard},
        "total": total,
        "misconception_labels": [misconception["label"]] if misconception.get("detected") and misconception.get("label") else [],
        "ta_notes": "Approved via PeerReview.ai grade-approval gate.",
        "feedback_style": "concise",
    })

    final = {
        "greeting": fb["greeting"],
        "letter_paragraphs": fb["letter_paragraphs"],
        "plain_text": fb["plain_text"],
        "breakdown": [{"label": c["label"], "score": c["proposed"], "max": c["max"]} for c in scorecard],
        "total": total,
        "max_total": max_total,
        "grade_caption": grade_caption,
        "show_failed_tests": show_failed_tests,
        "failed_tests": failed_tests,
        "saved_path": saved.get("saved_path", ""),
    }
    return surfaces.FINAL_SURFACE, surfaces.build_final_surface(final)


def set_calibration_enabled(enabled: bool) -> None:
    _STATE["calibration_enabled"] = enabled


def reset_calibration_memory() -> int:
    return store.reset_calibration()

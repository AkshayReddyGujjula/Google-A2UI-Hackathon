"""Deterministic A2UI surface builders for the review + feedback cockpit.

The agent's analysis produces structured data; these builders compose it into
trusted A2UI component trees. The review surface is ADAPTIVE: it always shows
test results + a general CaseComparison (input → expected vs actual) + scorecard
+ approval gate, and only adds the VisualGraphTracePanel for graph assignments.
"""
from __future__ import annotations

import json
from typing import Any

REVIEW_SURFACE = "peerreview-review"
FINAL_SURFACE = "peerreview-final"
SETUP_SURFACE = "peerreview-setup"  # retained for compatibility


class Builder:
    def __init__(self) -> None:
        self.nodes: list[dict[str, Any]] = []
        self._n = 0

    def add(self, component: str, **props: Any) -> str:
        cid = f"c{self._n}"
        self._n += 1
        self.nodes.append({"id": cid, "component": component, **props})
        return cid

    def finish(self, component: str, **props: Any) -> list[dict[str, Any]]:
        self.nodes.append({"id": "root", "component": component, **props})
        return self.nodes


def _short(v: Any, n: int = 80) -> str:
    s = v if isinstance(v, str) else json.dumps(v)
    return s if len(s) <= n else s[: n - 1] + "…"


def _trace_props(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "caseName": t.get("case_name"),
        "caseStatus": t.get("case_status"),
        "caseMessage": t.get("case_message"),
        "nodes": t.get("nodes", []),
        "edges": t.get("edges", []),
        "start": t.get("start"),
        "goal": t.get("goal"),
        "expectedPath": t.get("expected_path"),
        "studentPath": t.get("student_path"),
        "expectedEdges": t.get("expected_edges"),
        "studentEdges": t.get("student_edges"),
        "isMinimal": t.get("is_minimal"),
    }


def build_review_surface(rv: dict[str, Any]) -> list[dict[str, Any]]:
    b = Builder()
    children: list[str] = []
    diff = rv.get("diff", {})
    summary = diff.get("summary", {"total": 0, "passed": 0, "failed": 0})
    cases = diff.get("cases", [])

    children.append(b.add("Heading", text=f"Marking — {rv.get('submission_name', 'submission')}", level="1"))
    children.append(b.add("Overline", text=f"{rv.get('assignment_title', '')} · {rv.get('source', '')}"))

    # Repository summary
    repo = rv.get("repo", {})
    children.append(b.add("Section", title="Submission", eyebrow="INGESTED",
        child=b.add("Row", gap="sm", children=[
            b.add("Badge", label=f"{repo.get('file_count', 0)} files", tone="neutral"),
            b.add("Badge", label=f"entry: {repo.get('entry_file', '?')}", tone="info"),
            b.add("Badge", label=f"fn: {repo.get('entry_func', '?')}", tone="neutral"),
        ])))

    if rv.get("entry_code"):
        children.append(b.add("Section", title="Submitted code", eyebrow="ENTRY POINT",
            child=b.add("CodeBlock", code=rv["entry_code"], language="python", title=repo.get("entry_file", ""))))

    # Test results (real execution)
    tests = [{"name": c["name"], "status": c["status"], "message": c.get("message", "")} for c in cases]
    children.append(b.add("Section", title="Test results", eyebrow="REAL EXECUTION",
        child=b.add("TestResultsPanel", summary=summary, tests=tests, note=diff.get("fatal"))))

    # Adaptive: general case comparison (input → expected vs actual)
    if cases:
        cmp_rows = [{
            "name": c["name"], "status": c["status"],
            "input": _short(c.get("input")), "expected": _short(c.get("expected")),
            "actual": _short(c.get("actual")),
        } for c in cases]
        children.append(b.add("Section", title="What happened", eyebrow="INPUT → EXPECTED vs ACTUAL",
            child=b.add("CaseComparisonPanel", cases=cmp_rows)))

    # Adaptive: graph trace only when present
    if rv.get("trace"):
        t = rv["trace"]
        child_props = _trace_props(t)
        child_props["traces"] = [_trace_props(x) for x in t.get("traces", [])]
        children.append(b.add("Section", title="Traversal traces", eyebrow="EXPECTED vs STUDENT PATH",
            child=b.add("VisualGraphTracePanel", **child_props)))

    # Misconception
    misc = rv.get("misconception", {})
    if misc.get("detected"):
        children.append(b.add("Section", title="Where it went wrong", eyebrow="DIAGNOSIS",
            child=b.add("MisconceptionPanel", label=misc.get("label", ""), title=misc.get("title", ""),
                        severity=misc.get("severity", "medium"), explanation=misc.get("explanation", ""),
                        evidence=misc.get("evidence", []), detected=True)))
    else:
        children.append(b.add("Section", title="Diagnosis", eyebrow="CLEAN",
            child=b.add("Callout", tone="positive", title="No issues detected",
                        body="The submission passed every check.")))

    # Scorecard
    score_rows = [{"criterion": c["label"], "score": f"{c['proposed']}/{c['max']}", "rationale": c.get("rationale", "")}
                  for c in rv.get("scorecard", [])]
    children.append(b.add("Section", title="Proposed marks", eyebrow="EVIDENCE-BASED",
        child=b.add("DataTable", columns=[
            {"key": "criterion", "label": "Criterion"}, {"key": "score", "label": "Proposed", "align": "right"},
            {"key": "rationale", "label": "Why"}], rows=score_rows)))

    # Calibration (built from this assignment's own approved marks)
    cal = rv.get("calibration", {})
    if cal.get("count"):
        children.append(b.add("Section", title="Your marking so far", eyebrow="CALIBRATION",
            child=b.add("Stack", gap="sm", children=[
                b.add("BulletList", items=cal.get("tendencies", [])),
            ])))

    # Approval gate
    children.append(b.add("Section", title="Approve", eyebrow="YOU DECIDE",
        child=b.add("GradeApprovalPanel", criteria=rv.get("scorecard", []),
                    total=rv.get("proposed_total", 0), maxTotal=rv.get("max_total", 0),
                    showFailedTestsDefault=False)))

    return b.finish("Stack", gap="lg", children=children)


def build_final_surface(fb: dict[str, Any]) -> list[dict[str, Any]]:
    b = Builder()
    children: list[str] = []
    children.append(b.add("Heading", text="Feedback", level="1"))

    letter = [b.add("Overline", text="STUDENT FEEDBACK"),
              b.add("Heading", text=fb.get("greeting", "Feedback"), level="2")]
    for p in fb.get("letter_paragraphs", []):
        letter.append(b.add("Text", text=p))
    children.append(b.add("Card", tone="lilac", child=b.add("Stack", gap="sm", children=letter)))

    rows = [{"criterion": c["label"], "score": f"{c['score']}/{c['max']}"} for c in fb.get("breakdown", [])]
    children.append(b.add("Section", title="Mark breakdown", eyebrow="APPROVED",
        child=b.add("Stack", gap="md", children=[
            b.add("DataTable", columns=[{"key": "criterion", "label": "Criterion"},
                                        {"key": "score", "label": "Mark", "align": "right"}], rows=rows),
            b.add("StatCard", label="Total", value=f"{fb.get('total', 0)} / {fb.get('max_total', 0)}",
                  caption=fb.get("grade_caption", "")),
        ])))

    if fb.get("show_failed_tests") and fb.get("failed_tests"):
        tests = [{"name": c["name"], "status": c["status"], "message": c.get("message", "")}
                 for c in fb["failed_tests"]]
        children.append(b.add("Section", title="Cases shown to student", eyebrow="TA ENABLED",
            child=b.add("TestResultsPanel",
                        summary={"total": len(tests), "passed": 0, "failed": len(tests)}, tests=tests)))

    return b.finish("Stack", gap="lg", children=children)

"""Deterministic A2UI surface builders.

The agent's LLM produces structured analysis (rubric, test outcomes, misconception
text, scores). These builders turn that data into A2UI component trees using the
PeerReview catalog — so the *layout* is trusted application code and only the
*content* is model-generated. Each builder returns a flat list of component
nodes with exactly one `id: "root"`, ready for a2ui.update_components.
"""
from __future__ import annotations

from typing import Any


class Builder:
    """Accumulates A2UI component nodes with unique ids; `finish` sets root."""

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


SETUP_SURFACE = "peerreview-setup"
REVIEW_SURFACE = "peerreview-review"
FINAL_SURFACE = "peerreview-final"


# ── Phase 1: setup workspace ────────────────────────────────────────────────────
def build_setup_surface(ws: dict[str, Any]) -> list[dict[str, Any]]:
    b = Builder()
    rubric = ws["rubric"]
    ep = rubric.get("entry_point", {})
    children: list[str] = []

    children.append(b.add("Heading", text="Marking Workspace", level="1"))
    children.append(b.add("Overline", text=f"ASSIGNMENT · {rubric.get('assignment_id','')}"))

    # Assignment summary card
    summary_inner = b.add(
        "Stack",
        gap="sm",
        children=[
            b.add("Heading", text=rubric.get("title", "Assignment"), level="2"),
            b.add("Text", text=ws.get("summary", ""), tone="muted"),
            b.add(
                "Row",
                gap="sm",
                children=[
                    b.add("Badge", label=rubric.get("assignment_type", "assignment"), tone="info"),
                    b.add("Badge", label=rubric.get("language", "python"), tone="neutral"),
                    b.add("Badge", label=f"entry: {ep.get('function','?')}", tone="neutral"),
                    b.add("Badge", label=f"{rubric.get('total_marks','?')} marks", tone="neutral"),
                ],
            ),
        ],
    )
    children.append(b.add("Card", child=summary_inner, tone="default"))

    # Rubric table
    rubric_rows = [
        {"criterion": c["label"], "max": c["max"], "assesses": c["description"]}
        for c in rubric.get("criteria", [])
    ]
    rubric_table = b.add(
        "DataTable",
        columns=[
            {"key": "criterion", "label": "Criterion"},
            {"key": "max", "label": "Max", "align": "right"},
            {"key": "assesses", "label": "What we assess"},
        ],
        rows=rubric_rows,
    )
    children.append(b.add("Section", title="Rubric", eyebrow="STRUCTURED", child=rubric_table))

    # LinkUp reference panel
    ref = ws.get("reference")
    if ref:
        ref_panel = b.add(
            "ReferenceContextPanel",
            topic=ref.get("reference_topic", ""),
            answer=ref.get("answer", ""),
            sources=ref.get("sources", []),
            grounded=bool(ref.get("grounded")),
            usedFor=ref.get("used_for", ""),
            gradingImpact=ref.get("grading_impact", ""),
        )
        children.append(
            b.add("Section", title="Reference context", eyebrow="LINKUP · SOURCE-GROUNDED", child=ref_panel)
        )

    # Generated + validated test suite
    val = ws.get("validation", {})
    preview = ws.get("test_preview", [])
    test_rows = [
        {"test": t["name"], "checks": t.get("checks", ""), "status": "✓ validated"}
        for t in preview
    ]
    suite_children = [
        b.add(
            "Callout",
            tone="positive" if val.get("valid") else "warning",
            title="Tests validated against reference solution",
            body=val.get("message", ""),
        ),
        b.add(
            "DataTable",
            columns=[
                {"key": "test", "label": "Test"},
                {"key": "checks", "label": "Property checked"},
                {"key": "status", "label": "Status", "align": "right"},
            ],
            rows=test_rows,
        ),
    ]
    children.append(
        b.add(
            "Section",
            title="Generated test suite",
            eyebrow="TA-ONLY · FROZEN ON APPROVAL",
            child=b.add("Stack", gap="md", children=suite_children),
        )
    )

    # Ambiguity warnings (optional)
    for warn in ws.get("warnings", []):
        children.append(b.add("Callout", tone="warning", title="Ambiguity", body=warn))

    # Approval gate
    approval = b.add(
        "Stack",
        gap="md",
        children=[
            b.add(
                "Callout",
                tone="info",
                title="Human approval gate",
                body="Approving freezes this rubric + test suite. Marking will run only "
                "against the frozen tests, code evidence, and your approval.",
            ),
            b.add(
                "Row",
                gap="sm",
                children=[
                    b.add("Button", label="Approve & Freeze Workspace", variant="primary",
                          action={"event": {"name": "approve_workspace", "context": {}}}),
                    b.add("Button", label="Regenerate tests", variant="secondary",
                          action={"event": {"name": "regenerate_tests", "context": {}}}),
                ],
            ),
        ],
    )
    children.append(b.add("Section", title="Approve workspace", eyebrow="STEP 4", child=approval))

    return b.finish("Stack", gap="lg", children=children)


def build_frozen_confirmation(ws: dict[str, Any]) -> list[dict[str, Any]]:
    b = Builder()
    children = [
        b.add("Heading", text="Workspace frozen", level="1"),
        b.add(
            "Callout",
            tone="positive",
            title=f"Workspace {ws.get('workspace_id','')}",
            body="Rubric and validated test suite are frozen. Open the Review tab and "
            "load a submission (seeded sample, pasted code, or a public GitHub repo).",
        ),
        b.add(
            "Row",
            gap="sm",
            children=[
                b.add("Badge", label=f"{len(ws.get('frozen_tests_preview', []))} frozen tests", tone="positive"),
                b.add("Badge", label=ws.get("assignment_id", ""), tone="neutral"),
            ],
        ),
    ]
    return b.finish("Stack", gap="lg", children=children)


# ── Phase 2: submission review ──────────────────────────────────────────────────
def build_review_surface(rv: dict[str, Any]) -> list[dict[str, Any]]:
    b = Builder()
    children: list[str] = []

    children.append(b.add("Heading", text="Submission Review", level="1"))
    children.append(b.add("Overline", text=f"{rv.get('assignment_title','')} · {rv.get('source','')}"))

    # Repository summary
    repo = rv.get("repo", {})
    repo_inner = b.add(
        "Stack", gap="sm",
        children=[
            b.add("Text", text=f"Source: {rv.get('source','')}", tone="muted", size="sm"),
            b.add(
                "Row", gap="sm",
                children=[
                    b.add("Badge", label=f"{repo.get('file_count', 0)} files", tone="neutral"),
                    b.add("Badge", label=f"entry: {repo.get('entry_file','?')}", tone="info"),
                    b.add("Badge", label=f"fn: {repo.get('entry_func','?')}", tone="neutral"),
                ],
            ),
        ],
    )
    children.append(b.add("Section", title="Repository", eyebrow="INGESTED", child=b.add("Card", child=repo_inner)))

    # Entry-point code
    if rv.get("entry_code"):
        children.append(
            b.add("Section", title="Submitted code", eyebrow="ENTRY POINT",
                  child=b.add("CodeBlock", code=rv["entry_code"], language="python",
                              title=repo.get("entry_file", "")))
        )

    # Frozen test results
    tr = rv.get("test_results", {})
    results_panel = b.add(
        "TestResultsPanel",
        summary=tr.get("summary", {"total": 0, "passed": 0, "failed": 0}),
        tests=tr.get("tests", []),
        note=tr.get("error"),
    )
    children.append(b.add("Section", title="Frozen test results", eyebrow="REAL EXECUTION", child=results_panel))

    # Misconception
    misc = rv.get("misconception")
    if misc and misc.get("detected"):
        misc_panel = b.add(
            "MisconceptionPanel",
            label=misc.get("label", ""),
            title=misc.get("title", "Misconception detected"),
            severity=misc.get("severity", "medium"),
            explanation=misc.get("explanation", ""),
            evidence=misc.get("evidence", []),
            detected=True,
        )
        children.append(b.add("Section", title="Misconception", eyebrow="DETECTED FROM EVIDENCE", child=misc_panel))
    else:
        children.append(
            b.add("Section", title="Misconception", eyebrow="NONE DETECTED",
                  child=b.add("Callout", tone="positive", title="No misconception detected",
                              body="The submission's behaviour matches the expected algorithm."))
        )

    # Visual graph trace
    trace = rv.get("trace")
    if trace:
        trace_panel = b.add(
            "VisualGraphTracePanel",
            nodes=trace.get("nodes", []),
            edges=trace.get("edges", []),
            start=trace.get("start"),
            goal=trace.get("goal"),
            expectedPath=trace.get("expected_path"),
            studentPath=trace.get("student_path"),
            expectedEdges=trace.get("expected_edges"),
            studentEdges=trace.get("student_edges"),
            isMinimal=trace.get("is_minimal"),
            studentError=trace.get("student_error"),
        )
        children.append(b.add("Section", title="Traversal trace", eyebrow="BFS LAYERS vs STUDENT PATH", child=trace_panel))

    # Rubric scorecard
    scorecard = rv.get("scorecard", [])
    score_rows = [
        {"criterion": c["label"], "score": f"{c['proposed']}/{c['max']}", "rationale": c.get("rationale", "")}
        for c in scorecard
    ]
    children.append(
        b.add("Section", title="Rubric scorecard", eyebrow="PROPOSED · EVIDENCE-BASED",
              child=b.add("DataTable",
                          columns=[
                              {"key": "criterion", "label": "Criterion"},
                              {"key": "score", "label": "Proposed", "align": "right"},
                              {"key": "rationale", "label": "Evidence / rationale"},
                          ],
                          rows=score_rows))
    )

    # Calibration
    cal = rv.get("calibration", {})
    if cal.get("count"):
        cal_children = [
            b.add("Callout", tone="info",
                  title=f"Based on {cal['count']} previous approved reviews",
                  body="Calibration is advisory only — it never changes the frozen tests or rubric weights."),
            b.add("BulletList", items=cal.get("tendencies", [])),
        ]
        avg = cal.get("criterion_averages") or {}
        if avg:
            cal_children.append(
                b.add("Row", gap="sm",
                      children=[b.add("Badge", label=f"{k} avg {v}", tone="neutral") for k, v in avg.items()])
            )
        cal_children.append(
            b.add("Row", gap="sm",
                  children=[
                      b.add("Button", label="Disable calibration", variant="ghost",
                            action={"event": {"name": "disable_calibration", "context": {}}}),
                      b.add("Button", label="Reset assignment memory", variant="ghost",
                            action={"event": {"name": "reset_calibration", "context": {}}}),
                  ])
        )
        children.append(b.add("Section", title="Calibration memory", eyebrow="SELF-IMPROVEMENT LOOP",
                              child=b.add("Stack", gap="md", children=cal_children)))

    # Grade approval gate
    gap = b.add(
        "GradeApprovalPanel",
        criteria=scorecard,
        total=rv.get("proposed_total", 0),
        maxTotal=rv.get("max_total", 0),
        showFailedTestsDefault=False,
    )
    children.append(b.add("Section", title="Approve grades", eyebrow="HUMAN-IN-THE-LOOP", child=gap))

    return b.finish("Stack", gap="lg", children=children)


# ── Phase 3: final feedback ─────────────────────────────────────────────────────
def build_final_surface(fb: dict[str, Any]) -> list[dict[str, Any]]:
    b = Builder()
    children: list[str] = []

    children.append(b.add("Heading", text="Final Feedback", level="1"))

    # Feedback letter
    paragraphs = fb.get("letter_paragraphs", [])
    letter_children = [b.add("Overline", text="STUDENT FEEDBACK"), b.add("Heading", text=fb.get("greeting", "Feedback"), level="2")]
    for p in paragraphs:
        letter_children.append(b.add("Text", text=p))
    children.append(b.add("Card", tone="lilac", child=b.add("Stack", gap="sm", children=letter_children)))

    # Mark breakdown
    rows = [{"criterion": c["label"], "score": f"{c['score']}/{c['max']}"} for c in fb.get("breakdown", [])]
    breakdown_children = [
        b.add("DataTable",
              columns=[{"key": "criterion", "label": "Criterion"}, {"key": "score", "label": "Mark", "align": "right"}],
              rows=rows),
        b.add("StatCard", label="Total", value=f"{fb.get('total',0)} / {fb.get('max_total',0)}",
              caption=fb.get("grade_caption", "")),
    ]
    children.append(b.add("Section", title="Mark breakdown", eyebrow="APPROVED", child=b.add("Stack", gap="md", children=breakdown_children)))

    # Included failed tests (only if TA enabled)
    if fb.get("show_failed_tests") and fb.get("failed_tests"):
        ft_panel = b.add("TestResultsPanel",
                         summary={"total": len(fb["failed_tests"]), "passed": 0, "failed": len(fb["failed_tests"])},
                         tests=fb["failed_tests"])
        children.append(b.add("Section", title="Failed tests shown to student", eyebrow="TA ENABLED", child=ft_panel))

    # Save / copy
    save_children = [
        b.add("Callout", tone="positive", title="Saved to archive",
              body=f"Feedback saved locally at {fb.get('saved_path','agent/data/peerreview/feedback')}."),
        b.add("Button", label="Copy feedback", variant="primary",
              action={"event": {"name": "copy_feedback", "context": {"text": fb.get("plain_text", "")}}}),
    ]
    children.append(b.add("Section", title="Archive", eyebrow="LOCAL · REDIS-READY", child=b.add("Stack", gap="md", children=save_children)))

    return b.finish("Stack", gap="lg", children=children)

"""Persistence + fixtures for PeerReview.ai.

MVP uses local JSON under agent/data/peerreview/. The hackathon plan documents
Redis (LangGraph checkpointer / LangCache / mem0) as the production upgrade for
checkpointing, caching and assignment memory; the interface here is small
enough to swap behind Redis later without touching the agents.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

# agent/src/peerreview/store.py -> parents[3] == repo root
ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "fixtures" / "peerreview"
DATA = ROOT / "agent" / "data" / "peerreview"
WORKSPACES = DATA / "workspaces"
FEEDBACK = DATA / "feedback"
CALIBRATION = DATA / "calibration"


def _ensure_dirs() -> None:
    for d in (WORKSPACES, FEEDBACK, CALIBRATION):
        d.mkdir(parents=True, exist_ok=True)


# ── fixtures (seeded demo data) ────────────────────────────────────────────────
def list_assignments() -> list[dict[str, Any]]:
    """Available seeded assignments (each dir under fixtures with a rubric)."""
    out: list[dict[str, Any]] = []
    base = FIXTURES
    if not base.exists():
        return out
    for d in sorted(base.iterdir()):
        rubric = d / "rubric.json"
        if d.is_dir() and rubric.exists():
            r = json.loads(rubric.read_text(encoding="utf-8"))
            out.append({"dir": d.name, "assignment_id": r.get("assignment_id"), "title": r.get("title")})
    return out


def load_assignment_fixture(dir_name: str = "assignment-bfs") -> dict[str, Any]:
    """Load a seeded assignment: brief text, structured rubric, reference
    solution source, and the canonical validated test suite source."""
    d = FIXTURES / dir_name
    rubric = json.loads((d / "rubric.json").read_text(encoding="utf-8"))
    brief = (d / "brief.md").read_text(encoding="utf-8") if (d / "brief.md").exists() else ""
    ref = (d / "reference_solution.py").read_text(encoding="utf-8") if (d / "reference_solution.py").exists() else ""
    tests = (d / "tests_reference.py").read_text(encoding="utf-8") if (d / "tests_reference.py").exists() else ""
    return {
        "dir": dir_name,
        "brief": brief,
        "rubric": rubric,
        "reference_solution": ref,
        "tests_source": tests,
    }


def load_submission_fixture(dir_name: str) -> dict[str, Any]:
    """Load every .py file under a seeded submission directory."""
    d = FIXTURES / dir_name
    files: dict[str, str] = {}
    if d.exists():
        for p in sorted(d.rglob("*.py")):
            files[p.relative_to(d).as_posix()] = p.read_text(encoding="utf-8")
    return {"source": dir_name, "files": files}


# ── frozen workspaces ──────────────────────────────────────────────────────────
def freeze_workspace(workspace: dict[str, Any]) -> dict[str, Any]:
    """Persist an approved workspace (rubric + validated frozen tests +
    reference solution + entry point). Returns the stored record."""
    _ensure_dirs()
    wid = workspace.get("workspace_id") or f"ws-{int(time.time())}"
    workspace["workspace_id"] = wid
    workspace["frozen_at"] = workspace.get("frozen_at") or _now()
    workspace["status"] = "frozen"
    (WORKSPACES / f"{wid}.json").write_text(
        json.dumps(workspace, indent=2), encoding="utf-8"
    )
    return workspace


def load_workspace(workspace_id: str) -> dict[str, Any] | None:
    p = WORKSPACES / f"{workspace_id}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def latest_workspace(assignment_id: str | None = None) -> dict[str, Any] | None:
    """Most recently frozen workspace, optionally filtered by assignment."""
    if not WORKSPACES.exists():
        return None
    best: tuple[float, dict[str, Any]] | None = None
    for p in WORKSPACES.glob("*.json"):
        rec = json.loads(p.read_text(encoding="utf-8"))
        if assignment_id and rec.get("assignment_id") != assignment_id:
            continue
        mtime = p.stat().st_mtime
        if best is None or mtime > best[0]:
            best = (mtime, rec)
    return best[1] if best else None


# ── calibration memory ─────────────────────────────────────────────────────────
def load_calibration_history(assignment_id: str) -> list[dict[str, Any]]:
    """Seeded fixtures + any TA-approved records for this assignment, newest first."""
    records: list[dict[str, Any]] = []
    seed_dir = FIXTURES / "calibration-history"
    if seed_dir.exists():
        for p in sorted(seed_dir.glob("*.json")):
            rec = json.loads(p.read_text(encoding="utf-8"))
            if rec.get("assignment_id") == assignment_id:
                records.append(rec)
    if CALIBRATION.exists():
        for p in sorted(CALIBRATION.glob("*.json")):
            rec = json.loads(p.read_text(encoding="utf-8"))
            if rec.get("assignment_id") == assignment_id:
                records.append(rec)
    records.sort(key=lambda r: r.get("approved_at", ""), reverse=True)
    return records


def summarize_calibration(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Turn prior approved reviews into TA-facing tendencies. Deterministic —
    no model call. Never changes rubric weights or frozen tests; it only
    annotates what the TA has historically done."""
    n = len(records)
    if n == 0:
        return {"count": 0, "tendencies": [], "misconception_counts": {}}

    # Average score per criterion across records that recorded it.
    crit_totals: dict[str, list[int]] = {}
    for rec in records:
        for cid, val in (rec.get("scores") or {}).items():
            crit_totals.setdefault(cid, []).append(val)
    crit_avg = {cid: round(sum(v) / len(v), 2) for cid, v in crit_totals.items()}

    misconception_counts: dict[str, int] = {}
    for rec in records:
        for label in rec.get("misconception_labels") or []:
            misconception_counts[label] = misconception_counts.get(label, 0) + 1

    tendencies: list[str] = []
    clean = [r for r in records if not r.get("misconception_labels")]
    if clean:
        tendencies.append(
            f"On {len(clean)} clean BFS submissions the TA awarded full "
            f"algorithmic-understanding marks when a queue + visited set were present."
        )
    if misconception_counts.get("dfs_instead_of_bfs"):
        c = misconception_counts["dfs_instead_of_bfs"]
        tendencies.append(
            f"On {c} prior submission(s) flagged as DFS-instead-of-BFS, the TA "
            f"reduced correctness and algorithmic understanding and added a concise "
            f"misconception note."
        )
    styles = [r.get("feedback_style") for r in records if r.get("feedback_style")]
    if styles:
        common = max(set(styles), key=styles.count)
        tendencies.append(f"Preferred feedback style across prior reviews: {common}.")

    return {
        "count": n,
        "criterion_averages": crit_avg,
        "misconception_counts": misconception_counts,
        "tendencies": tendencies,
    }


def save_calibration_record(record: dict[str, Any]) -> dict[str, Any]:
    _ensure_dirs()
    rid = record.get("record_id") or f"rec-{int(time.time())}"
    record["record_id"] = rid
    record["approved_at"] = record.get("approved_at") or _now()
    (CALIBRATION / f"{rid}.json").write_text(
        json.dumps(record, indent=2), encoding="utf-8"
    )
    return record


def reset_calibration() -> int:
    """Delete TA-approved calibration records (seeded fixtures are untouched)."""
    if not CALIBRATION.exists():
        return 0
    n = 0
    for p in CALIBRATION.glob("*.json"):
        p.unlink()
        n += 1
    return n


# ── final feedback archive ──────────────────────────────────────────────────────
def save_feedback(record: dict[str, Any]) -> dict[str, Any]:
    _ensure_dirs()
    fid = record.get("feedback_id") or f"fb-{int(time.time())}"
    record["feedback_id"] = fid
    record["saved_at"] = record.get("saved_at") or _now()
    path = FEEDBACK / f"{fid}.json"
    path.write_text(json.dumps(record, indent=2), encoding="utf-8")
    record["saved_path"] = str(path)
    return record


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

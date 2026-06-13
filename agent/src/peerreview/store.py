"""Local-JSON persistence for the workspace/submission directory model.

Layout (everything the TA creates lives here; nothing is preloaded):
  agent/data/peerreview/workspaces/<wid>/assignment.json
  agent/data/peerreview/workspaces/<wid>/submissions/<sid>.json

An assignment workspace is a "folder"; submissions are the "files" inside it.
Calibration memory is derived live from the workspace's own approved reviews.
Redis is the documented production upgrade behind this small interface.
"""
from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "agent" / "data" / "peerreview"
WORKSPACES = DATA / "workspaces"


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "assignment").lower()).strip("-")
    return (s[:32] or "assignment") + "-" + uuid.uuid4().hex[:6]


def _wdir(wid: str) -> Path:
    return WORKSPACES / wid


# ── workspaces (assignments) ──────────────────────────────────────────────────────
def create_workspace(spec: dict[str, Any]) -> dict[str, Any]:
    wid = spec.get("id") or _slug(spec.get("title", "assignment"))
    spec["id"] = wid
    spec["created_at"] = spec.get("created_at") or _now()
    spec["status"] = spec.get("status") or "draft"
    d = _wdir(wid)
    (d / "submissions").mkdir(parents=True, exist_ok=True)
    (d / "assignment.json").write_text(json.dumps(spec, indent=2), encoding="utf-8")
    return spec


def get_workspace(wid: str) -> dict[str, Any] | None:
    p = _wdir(wid) / "assignment.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def update_workspace(wid: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    ws = get_workspace(wid)
    if not ws:
        return None
    ws.update(patch)
    ws["updated_at"] = _now()
    (_wdir(wid) / "assignment.json").write_text(json.dumps(ws, indent=2), encoding="utf-8")
    return ws


def freeze_workspace(wid: str) -> dict[str, Any] | None:
    return update_workspace(wid, {"status": "frozen", "frozen_at": _now()})


def list_workspaces() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not WORKSPACES.exists():
        return out
    for d in WORKSPACES.iterdir():
        ap = d / "assignment.json"
        if not ap.exists():
            continue
        ws = json.loads(ap.read_text(encoding="utf-8"))
        subs = list_submissions(ws["id"])
        out.append({
            "id": ws["id"], "title": ws.get("title", "Untitled"),
            "status": ws.get("status", "draft"),
            "assignment_type": ws.get("assignment_type", "general"),
            "created_at": ws.get("created_at", ""),
            "submission_count": len(subs),
            "marked_count": sum(1 for s in subs if s.get("status") == "approved"),
        })
    out.sort(key=lambda w: w.get("created_at", ""), reverse=True)
    return out


def delete_workspace(wid: str) -> bool:
    import shutil
    d = _wdir(wid)
    if d.exists():
        shutil.rmtree(d)
        return True
    return False


# ── submissions ─────────────────────────────────────────────────────────────────
def add_submission(wid: str, record: dict[str, Any]) -> dict[str, Any]:
    sid = record.get("id") or ("sub-" + uuid.uuid4().hex[:8])
    record["id"] = sid
    record["created_at"] = record.get("created_at") or _now()
    record["status"] = record.get("status") or "pending"
    (_wdir(wid) / "submissions").mkdir(parents=True, exist_ok=True)
    (_wdir(wid) / "submissions" / f"{sid}.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    return record


def get_submission(wid: str, sid: str) -> dict[str, Any] | None:
    p = _wdir(wid) / "submissions" / f"{sid}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def update_submission(wid: str, sid: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    sub = get_submission(wid, sid)
    if not sub:
        return None
    sub.update(patch)
    sub["updated_at"] = _now()
    (_wdir(wid) / "submissions" / f"{sid}.json").write_text(json.dumps(sub, indent=2), encoding="utf-8")
    return sub


def list_submissions(wid: str) -> list[dict[str, Any]]:
    d = _wdir(wid) / "submissions"
    out: list[dict[str, Any]] = []
    if not d.exists():
        return out
    for p in d.glob("*.json"):
        s = json.loads(p.read_text(encoding="utf-8"))
        out.append({
            "id": s["id"], "name": s.get("name", s["id"]), "source": s.get("source", ""),
            "status": s.get("status", "pending"),
            "total": s.get("total"), "max_total": s.get("max_total"),
            "created_at": s.get("created_at", ""),
        })
    out.sort(key=lambda s: s.get("created_at", ""))
    return out


# ── calibration (derived live from this workspace's approved reviews) ──────────────
def load_calibration_history(wid: str) -> list[dict[str, Any]]:
    records = []
    for s in list_submissions(wid):
        if s.get("status") != "approved":
            continue
        full = get_submission(wid, s["id"]) or {}
        records.append({
            "scores": full.get("scores", {}),
            "total": full.get("total"),
            "misconception_labels": full.get("misconception_labels", []),
        })
    return records


def summarize_calibration(records: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(records)
    if n == 0:
        return {"count": 0, "tendencies": [], "criterion_averages": {}}
    crit_totals: dict[str, list[int]] = {}
    for rec in records:
        for cid, val in (rec.get("scores") or {}).items():
            crit_totals.setdefault(cid, []).append(val)
    crit_avg = {cid: round(sum(v) / len(v), 2) for cid, v in crit_totals.items()}
    misc: dict[str, int] = {}
    for rec in records:
        for label in rec.get("misconception_labels") or []:
            misc[label] = misc.get(label, 0) + 1
    tendencies = [f"Based on {n} mark(s) you've approved for this assignment."]
    clean = sum(1 for r in records if not r.get("misconception_labels"))
    if clean:
        tendencies.append(f"{clean} submission(s) passed every check and received high marks.")
    if misc:
        top = max(misc, key=misc.get)
        tendencies.append(f"Most common issue so far: {top.replace('_', ' ')} ({misc[top]}×).")
    return {"count": n, "criterion_averages": crit_avg, "tendencies": tendencies,
            "misconception_counts": misc}

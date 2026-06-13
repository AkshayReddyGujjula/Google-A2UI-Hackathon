"""Evidence-based, assignment-agnostic analysis.

Marks-bearing decisions come from REAL differential test results (which cases the
student passed/failed) mapped onto the rubric by each criterion's `kind`. Gemini
is used only to (a) explain, in plain language, the conceptual error behind the
failing cases and (b) polish the feedback letter — never to decide a score. Both
have deterministic fallbacks so a transient model error can't break marking.
"""
from __future__ import annotations

import os
import re
from typing import Any


# ── code signals (cheap, auditable) ───────────────────────────────────────────────
def code_signals(code: str) -> dict[str, bool]:
    return {
        "has_debug_print": bool(re.search(r"^\s*print\(", code or "", re.MULTILINE)),
        "very_long": len((code or "").splitlines()) > 120,
    }


def _rates(cases: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(cases)
    passed = sum(1 for c in cases if c.get("status") == "passed")
    corr = [c for c in cases if c.get("kind") != "edge_case"]
    edge = [c for c in cases if c.get("kind") == "edge_case"]

    def rate(group: list[dict[str, Any]]) -> float:
        return (sum(1 for c in group if c.get("status") == "passed") / len(group)) if group else 1.0

    return {
        "total": total, "passed": passed,
        "overall": (passed / total) if total else 1.0,
        "correctness": rate(corr), "correctness_n": len(corr),
        "correctness_pass": sum(1 for c in corr if c.get("status") == "passed"),
        "edge": rate(edge), "edge_n": len(edge),
        "edge_pass": sum(1 for c in edge if c.get("status") == "passed"),
    }


# ── score proposal (rubric-driven by criterion kind) ──────────────────────────────
def propose_scores(rubric: dict[str, Any], diff: dict[str, Any], code: str,
                   misconception: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    cases = diff.get("cases", [])
    r = _rates(cases)
    sig = code_signals(code)
    high_misconception = bool(misconception and misconception.get("detected")
                              and misconception.get("severity") == "high")
    out: list[dict[str, Any]] = []
    for crit in rubric.get("criteria", []):
        mx = int(crit.get("max", 0))
        kind = crit.get("kind", "correctness")
        if kind == "correctness":
            score = round(mx * r["correctness"])
            rationale = f"{r['correctness_pass']}/{r['correctness_n']} correctness cases pass."
        elif kind == "edge_cases":
            score = round(mx * r["edge"])
            rationale = (f"{r['edge_pass']}/{r['edge_n']} edge cases pass."
                         if r["edge_n"] else "No edge cases failed.")
        elif kind == "algorithmic_understanding":
            score = round(mx * r["overall"])
            if high_misconception:
                score = min(score, mx // 2)
            rationale = (f"Behaviour matches the expected approach on {r['passed']}/{r['total']} cases."
                         + (" Approach diverges on key cases." if high_misconception else ""))
        elif kind == "code_quality":
            score = mx - (1 if sig["has_debug_print"] else 0)
            rationale = "Leftover debug prints." if sig["has_debug_print"] else "Readable and reasonably structured."
        else:
            score = round(mx * r["overall"])
            rationale = f"{r['passed']}/{r['total']} cases pass."
        out.append({
            "id": crit.get("id", kind), "label": crit.get("label", kind), "kind": kind,
            "max": mx, "proposed": max(0, min(mx, score)), "rationale": rationale,
        })
    return out


# ── misconception (general; LLM-explained, deterministic fallback) ─────────────────
def detect_misconception(diff: dict[str, Any], code: str, spec: dict[str, Any]) -> dict[str, Any]:
    cases = diff.get("cases", [])
    failing = [c for c in cases if c.get("status") != "passed"]
    if diff.get("fatal"):
        return {"detected": True, "label": "did_not_run", "title": "Submission did not run",
                "severity": "high", "explanation": diff["fatal"][:300],
                "evidence": [diff["fatal"][:200]]}
    if not failing:
        return {"detected": False, "label": None, "title": "No issues detected",
                "severity": "none", "explanation": "", "evidence": []}
    if diff.get("timed_out"):
        return {"detected": True, "label": "infinite_loop",
                "title": "Possible infinite loop / non-termination", "severity": "high",
                "explanation": "The submission did not terminate within the time limit on at least one input "
                               "— often a missing visited/seen set or a loop that never advances.",
                "evidence": [c["message"] for c in failing if c.get("message")][:3]}
    evidence = [f"{c['name']}: {c.get('message', 'failed')}" for c in failing][:4]
    base = {"detected": True, "label": "logic_error",
            "title": f"Incorrect on {len(failing)} of {len(cases)} cases",
            "severity": "high" if len(failing) > len(cases) / 2 else "medium",
            "explanation": "", "evidence": evidence}
    explained = _explain_failures(spec, failing, code)
    if explained:
        base.update(explained)
    else:
        base["explanation"] = ("The submission's output differs from the expected result on the cases above. "
                               "Compare the expected vs actual values to see where the logic diverges.")
    return base


def _explain_failures(spec: dict[str, Any], failing: list[dict[str, Any]], code: str) -> dict[str, Any] | None:
    if not os.getenv("GEMINI_API_KEY"):
        return None
    try:
        from langchain_core.messages import HumanMessage, SystemMessage
        from . import model

        cases_txt = "\n".join(
            f"- input={c.get('input')}, expected={c.get('expected')}, got={c.get('actual')}"
            for c in failing[:5]
        )
        sys_p = ("You are a CS teaching assistant. Given a coding task, a student's code, and the "
                 "specific failing cases (input/expected/actual), explain the ROOT conceptual mistake "
                 "in 2-3 sentences, plainly, for the student. Return STRICT JSON: "
                 '{"title": "<=6 word label", "explanation": "2-3 sentences"}. No prose outside JSON.')
        usr = (f"Task: {spec.get('title')} ({spec.get('assignment_type')})\n"
               f"Function: {spec.get('signature')}\n\nStudent code:\n{code[:2500]}\n\nFailing cases:\n{cases_txt}")
        m = model.build_chat_model(temperature=0.2)
        resp = m.invoke([SystemMessage(content=sys_p), HumanMessage(content=usr)])
        text = model.text_of(resp)
        import json
        a, b = text.find("{"), text.rfind("}")
        obj = json.loads(text[a:b + 1])
        return {"title": obj.get("title") or "Logic error", "explanation": obj.get("explanation", "")}
    except Exception:  # noqa: BLE001
        return None


# ── feedback letter (templated; Gemini-polished when available) ────────────────────
def build_feedback(spec: dict[str, Any], scorecard: list[dict[str, Any]], misconception: dict[str, Any],
                   reference: dict[str, Any] | None, include_resource: bool,
                   total: int, max_total: int) -> dict[str, Any]:
    strong = ", ".join(c["label"] for c in scorecard if c["proposed"] == c["max"])
    paras: list[str] = [
        f"Thanks for your submission to “{spec.get('title', 'this assignment')}”. "
        f"You scored {total} out of {max_total}."
    ]
    if strong:
        paras.append(f"What you did well: full marks on {strong}.")
    if misconception.get("detected"):
        paras.append(f"Main thing to revisit: {misconception.get('title', '')}. "
                     + (misconception.get("explanation") or ""))
    else:
        paras.append("Your solution passed every check — nicely done.")
    if include_resource and reference and reference.get("sources"):
        s = reference["sources"][0]
        paras.append(f"Optional reading: {s.get('name', 'reference')} — {s.get('url', '')}")
    plain = "\n\n".join(p.strip() for p in paras if p.strip())
    return {"greeting": "Feedback on your submission",
            "letter_paragraphs": _maybe_polish(paras), "plain_text": plain}


def _maybe_polish(paragraphs: list[str]) -> list[str]:
    if not os.getenv("GEMINI_API_KEY"):
        return paragraphs
    try:
        from langchain_core.messages import HumanMessage, SystemMessage
        from . import model

        m = model.build_chat_model(temperature=0.3)
        prompt = ("Rewrite this student feedback to be warm, concise, and encouraging. Do NOT change "
                  "any facts, scores, or the technical explanation. Keep the same number of short "
                  "paragraphs, separated by a blank line.\n\n" + "\n\n".join(paragraphs))
        resp = m.invoke([SystemMessage(content="You are a supportive CS teaching assistant."),
                         HumanMessage(content=prompt)])
        text = model.text_of(resp)
        out = [p.strip() for p in text.split("\n\n") if p.strip()]
        return out or paragraphs
    except Exception:  # noqa: BLE001
        return paragraphs

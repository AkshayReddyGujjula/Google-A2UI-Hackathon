"""Real LLM generation for ANY Python coding assignment (Gemini).

From the uploaded assessment document we derive, with the model:
  - the entry function to grade (name + signature) and the assignment type,
  - a structured rubric (criteria with a `kind` so scoring is general),
  - a set of representative + edge-case INPUTS, each tagged by kind,
  - a named COMPARATOR describing how a correct answer is judged
    (exact / set_equal / sorted_equal / multiset_equal / float_close /
     shortest_path_unweighted), with an optional custom property check,
  - a trusted REFERENCE SOLUTION.

Marking then runs the student's function AND the reference on every input
(differential testing, real subprocess execution in test_runner) and compares
with the chosen comparator. This is far more reliable across arbitrary problems
than asking the model to hand-write a pytest file, and it feeds the
CaseComparison panel (input → expected vs actual) for free.
"""
from __future__ import annotations

import json
import re
from typing import Any

from . import model, test_runner

COMPARATORS = (
    "exact",
    "set_equal",
    "sorted_equal",
    "multiset_equal",
    "float_close",
    "shortest_path_unweighted",
)


def _llm_json(system: str, user: str, *, temperature: float = 0.2) -> dict[str, Any]:
    """Call Gemini and parse a JSON object from the reply (tolerant of fences)."""
    from langchain_core.messages import HumanMessage, SystemMessage

    m = model.build_chat_model(temperature=temperature)
    resp = m.invoke([SystemMessage(content=system), HumanMessage(content=user)])
    return _extract_json(model.text_of(resp))


def _llm_code(system: str, user: str, *, temperature: float = 0.0) -> str:
    from langchain_core.messages import HumanMessage, SystemMessage

    m = model.build_chat_model(temperature=temperature)
    resp = m.invoke([SystemMessage(content=system), HumanMessage(content=user)])
    return _extract_code(model.text_of(resp))


def _extract_json(text: str) -> dict[str, Any]:
    t = text.strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    a, b = t.find("{"), t.rfind("}")
    if a != -1 and b != -1 and b > a:
        t = t[a : b + 1]
    return json.loads(t)


def _extract_code(text: str) -> str:
    fence = re.search(r"```(?:python)?\s*(.*?)```", text, re.S)
    return (fence.group(1) if fence else text).strip()


# ── 1. analyze the assignment ────────────────────────────────────────────────────
_ANALYZE_SYS = """\
You are an experienced CS teaching assistant setting up automated marking for a
Python programming assignment. You only handle assignments where students implement
one Python function (or a small set) that can be unit-tested by calling it.

Return a STRICT JSON object (no prose) with this shape:
{
  "title": "...",
  "assignment_type": "graph_search | array | string | math | sorting | recursion | general",
  "language": "python",
  "supported": true,
  "entry_function": "name_students_must_define",
  "signature": "name(arg1, arg2) -> ret",
  "comparator": one of [exact, set_equal, sorted_equal, multiset_equal, float_close, shortest_path_unweighted],
  "comparator_note": "one line on why",
  "cases": [
     {"name": "short human description", "args": [<json args to call the function with>], "kind": "correctness|edge_case"}
  ],
  "rubric": {
     "total_marks": <int>,
     "criteria": [
        {"id": "snake_case", "label": "...", "max": <int>, "kind": "correctness|algorithmic_understanding|edge_cases|code_quality", "description": "..."}
     ]
  }
}

Rules:
- "args" must be valid JSON literals that can be splatted into the function call.
- Provide 6-10 cases mixing normal and edge cases (empty, single, duplicates, none-found, cycles, etc.).
- CRITICAL: include at least TWO ADVERSARIAL cases that a COMMON WRONG approach would get
  wrong but a correct one handles — these are what reveal misconceptions. Examples:
  * shortest path: a graph where exploring the first-listed neighbour leads DEEP down a long
    branch while the actual shortest route goes a different way (so a depth-first solution
    returns a valid but longer path than breadth-first).
  * sorting/search: already-sorted, reverse-sorted, duplicates, target absent, negatives.
  * recursion/DP: the base case and a large-ish input that a naive approach gets wrong.
  Design these concretely so the reference solution and a typical buggy attempt differ.
- Pick the comparator that makes a CORRECT answer pass regardless of an equally-valid alternative:
  use sorted_equal/set_equal/multiset_equal when order/grouping is irrelevant, float_close for floats,
  shortest_path_unweighted when the answer is a shortest path in an unweighted graph (multiple valid).
- Rubric: 3-4 criteria summing to total_marks; always include a correctness criterion.
- If the assignment is NOT a single testable Python function (essay, multi-file system, non-Python),
  set "supported": false and explain in "title".
"""


def analyze_assignment(doc_text: str, rubric_text: str = "") -> dict[str, Any]:
    user = f"ASSESSMENT DOCUMENT:\n{doc_text.strip()[:8000]}\n"
    if rubric_text.strip():
        user += (
            "\nThe TA also provided this rubric — convert it into the criteria array "
            f"(keep their weights/wording):\n{rubric_text.strip()[:3000]}\n"
        )
    spec = _llm_json(_ANALYZE_SYS, user)
    # Normalise + guard
    spec.setdefault("language", "python")
    spec.setdefault("comparator", "exact")
    if spec["comparator"] not in COMPARATORS:
        spec["comparator"] = "exact"
    spec.setdefault("cases", [])
    spec.setdefault("rubric", {"total_marks": 10, "criteria": []})
    for i, c in enumerate(spec["cases"]):
        c.setdefault("name", f"case {i + 1}")
        c.setdefault("kind", "correctness")
        c.setdefault("args", [])
    return spec


# ── 2. reference solution ────────────────────────────────────────────────────────
_REF_SYS = """\
Write a correct, clean Python reference solution for the assignment below. Output ONLY
the Python code (no prose, no tests). It MUST define the exact entry function named and
signed as given, behave correctly on all described cases and edge cases, and use only the
Python standard library. Keep it self-contained in one module.
"""


def generate_reference_solution(doc_text: str, spec: dict[str, Any]) -> str:
    user = (
        f"ASSESSMENT DOCUMENT:\n{doc_text.strip()[:8000]}\n\n"
        f"Entry function: {spec.get('entry_function')}\n"
        f"Signature: {spec.get('signature')}\n"
        f"It will be judged with comparator '{spec.get('comparator')}'.\n"
        f"Define `{spec.get('entry_function')}` exactly."
    )
    return _llm_code(_REF_SYS, user)


# ── 3. finalize: sanity-check the reference against the generated cases ────────────
def finalize_spec(doc_text: str, spec: dict[str, Any], reference_source: str) -> dict[str, Any]:
    """Run the reference solution on every case; drop cases the reference can't
    execute (keeps the case set trustworthy). One reference re-gen on broad failure."""
    entry = spec.get("entry_function", "")
    cases = spec.get("cases", [])

    def _probe(ref_src: str) -> list[dict[str, Any]]:
        return test_runner.probe_reference(ref_src, entry, cases, spec.get("comparator", "exact"))

    results = _probe(reference_source)
    ok = [r for r in results if r["reference_ok"]]
    if cases and len(ok) < max(1, len(cases) // 2):
        # Reference is broadly failing — regenerate once.
        reference_source = generate_reference_solution(doc_text, spec)
        results = _probe(reference_source)
        ok = [r for r in results if r["reference_ok"]]

    good_names = {r["name"] for r in ok}
    spec["cases"] = [c for c in cases if c["name"] in good_names] or cases
    spec["reference_solution"] = reference_source
    spec["reference_ok"] = bool(ok)
    # plain-language test list for the TA (selected by default)
    spec["tests"] = [
        {"name": c["name"], "kind": c.get("kind", "correctness"), "selected": True}
        for c in spec["cases"]
    ]
    return spec


# ── orchestrator used by the REST layer ───────────────────────────────────────────
def build_assignment(doc_text: str, rubric_text: str = "") -> dict[str, Any]:
    """Full Phase-1 generation. Returns a draft assignment spec (unsaved)."""
    spec = analyze_assignment(doc_text, rubric_text)
    if not spec.get("supported", True):
        return {"supported": False, "title": spec.get("title", "Unsupported assignment"),
                "message": "This assignment isn't a single testable Python function. "
                           "PeerReview.ai currently marks Python function assignments."}
    reference = generate_reference_solution(doc_text, spec)
    spec = finalize_spec(doc_text, spec, reference)
    spec["supported"] = True
    return spec

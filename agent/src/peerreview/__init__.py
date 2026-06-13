"""PeerReview.ai — agentic CS-assignment marking cockpit.

This package holds the domain logic that the two AG-UI agents
(setup_agent, review_agent) orchestrate:

  store        — load fixtures, freeze/load workspaces, persist feedback +
                 calibration records (local JSON; Redis is the documented
                 production upgrade).
  test_runner  — REAL execution of the frozen pytest suite against a code
                 directory (subprocess + timeout), plus deterministic graph
                 traversal traces for the VisualGraphTracePanel.
  linkup       — source-grounded reference lookup (LinkUp API; explanation
                 context only — never affects scoring).
  ingest       — load a student submission from a seeded fixture, pasted
                 files, or a public GitHub repo URL.
  surfaces     — deterministic A2UI component-tree builders. The LLM produces
                 structured analysis; these builders turn it into trusted UI.
"""

/** Typed client for the PeerReview.ai agent REST API (FastAPI on :8123).
 *  CRUD + generation + freeze. The review/feedback path goes via CopilotKit. */
import type { A2UIOp } from "@/a2ui/surface-bus";

const BASE = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8123";

export type WorkspaceSummary = {
  id: string;
  title: string;
  status: "draft" | "frozen";
  assignment_type: string;
  created_at: string;
  submission_count: number;
  marked_count: number;
};

export type Criterion = { id: string; label: string; max: number; kind: string; description?: string };
export type TestItem = { name: string; kind: string; selected: boolean };

export type Assignment = {
  id: string;
  title: string;
  status: "draft" | "frozen";
  assignment_type: string;
  entry_function: string;
  signature?: string;
  comparator: string;
  reference_solution?: string;
  reference_ok?: boolean;
  rubric: { total_marks: number; criteria: Criterion[] };
  cases: { name: string; kind: string }[];
  tests: TestItem[];
  reference?: { answer?: string; sources?: { name: string; url?: string; snippet?: string }[]; grounded?: boolean };
};

export type SubmissionSummary = {
  id: string;
  name: string;
  source: string;
  status: "pending" | "reviewed" | "approved" | "error";
  total?: number;
  max_total?: number;
};

export type ReviewSurfaceResponse = {
  surfaceId: string;
  operations: A2UIOp[];
};

async function call(path: string, opts: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  base: BASE,
  listAssignments: (): Promise<WorkspaceSummary[]> =>
    call("/api/assignments").then((d) => d.assignments),
  createAssignment: (doc_text: string, rubric_text = ""): Promise<Assignment> =>
    call("/api/assignments", { method: "POST", body: JSON.stringify({ doc_text, rubric_text }) }),
  getAssignment: (id: string): Promise<Assignment> => call(`/api/assignments/${id}`),
  patchAssignment: (id: string, patch: Partial<Assignment>): Promise<Assignment> =>
    call(`/api/assignments/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  freezeAssignment: (id: string): Promise<Assignment> =>
    call(`/api/assignments/${id}/freeze`, { method: "POST" }),
  regenerateTests: (id: string): Promise<Assignment> =>
    call(`/api/assignments/${id}/regenerate-tests`, { method: "POST" }),
  deleteAssignment: (id: string): Promise<{ deleted: boolean }> =>
    call(`/api/assignments/${id}`, { method: "DELETE" }),
  listSubmissions: (id: string): Promise<SubmissionSummary[]> =>
    call(`/api/assignments/${id}/submissions`).then((d) => d.submissions),
  addSubmission: (
    id: string,
    body: { name?: string; source_type: "pasted" | "github"; github_url?: string; pasted_files_json?: string },
  ): Promise<SubmissionSummary> =>
    call(`/api/assignments/${id}/submissions`, { method: "POST", body: JSON.stringify(body) }),
  deleteSubmission: (workspaceId: string, submissionId: string): Promise<{ deleted: boolean }> =>
    call(`/api/assignments/${workspaceId}/submissions/${submissionId}`, { method: "DELETE" }),
  reviewSubmissionSurface: (workspaceId: string, submissionId: string): Promise<ReviewSurfaceResponse> =>
    call(`/api/assignments/${workspaceId}/submissions/${submissionId}/review-surface`, { method: "POST" }),
};

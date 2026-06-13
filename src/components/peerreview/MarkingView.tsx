"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CopilotChat, useAgent } from "@copilotkit/react-core/v2";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Trash2,
} from "lucide-react";
import { SurfaceCanvas, CanvasEmptyState } from "@/components/pdf-analyst/SurfaceCanvas";
import { surfaceBus } from "@/a2ui/surface-bus";
import { saveElementAsPdf } from "@/lib/pdf-export";
import { api, type SubmissionSummary } from "@/lib/peerreview-api";

const AGENT_ID = "review_agent";

export function MarkingView({
  workspaceId,
  submissionId,
  submissionName,
}: {
  workspaceId: string;
  submissionId: string;
  submissionName: string;
}) {
  const router = useRouter();
  const { agent } = useAgent({ agentId: AGENT_ID });
  const isReady = Boolean(agent);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const reviewThreadId = `review:${workspaceId}:${submissionId}`;
  const surfaceScope = `peerreview:${workspaceId}:${submissionId}`;
  const reviewSurfaceId = `peerreview-review:${workspaceId}:${submissionId}`;
  const finalSurfaceId = `peerreview-final:${workspaceId}:${submissionId}`;

  useEffect(() => {
    surfaceBus.reset(surfaceScope);
    setReviewError(null);
  }, [surfaceScope]);

  useEffect(() => {
    if (!agent) return;
    const scopedAgent = agent as typeof agent & { threadId?: string };
    scopedAgent.threadId = reviewThreadId;
  }, [agent, reviewThreadId]);

  useEffect(() => {
    let cancelled = false;
    api
      .listSubmissions(workspaceId)
      .then((list) => {
        if (!cancelled) setSubmissions(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId, submissionId]);

  useEffect(() => {
    let cancelled = false;
    api
      .reviewSubmissionSurface(workspaceId, submissionId)
      .then((surface) => {
        if (cancelled) return;
        if (![reviewSurfaceId, finalSurfaceId].includes(surface.surfaceId)) {
          console.warn("[marking] ignoring unexpected surface", surface.surfaceId);
          return;
        }
        surfaceBus.push(surfaceScope, surface.operations);
      })
      .catch((e) => {
        if (!cancelled) setReviewError(String((e as Error).message || e));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, submissionId, surfaceScope, reviewSurfaceId, finalSurfaceId]);

  const savePdf = async () => {
    const el = surfaceRef.current?.querySelector<HTMLElement>(".a2ui-surface");
    if (!el) return;
    setSaving(true);
    try {
      await saveElementAsPdf(el, `${submissionName.replace(/[^a-z0-9-_]+/gi, "_")}-feedback.pdf`);
    } finally {
      setSaving(false);
    }
  };

  const currentIndex = submissions.findIndex((s) => s.id === submissionId);
  const nextSubmission =
    currentIndex >= 0
      ? submissions.slice(currentIndex + 1).find((s) => s.status !== "approved") ?? submissions[currentIndex + 1]
      : undefined;

  const deleteCurrentSubmission = async () => {
    if (!window.confirm(`Delete "${submissionName}"? This permanently removes the submission and any review/feedback.`)) {
      return;
    }
    setDeleting(true);
    try {
      await api.deleteSubmission(workspaceId, submissionId);
      surfaceBus.reset(surfaceScope);
      router.push(`/a/${workspaceId}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="h-14 shrink-0 border-b border-[var(--line)] bg-[var(--surface)] flex items-center gap-3 px-4">
        <Link href={`/a/${workspaceId}`} className="inline-flex items-center gap-1.5 text-[13px] text-[var(--ink-2)] hover:text-[var(--ink)]">
          <ArrowLeft size={16} /> Back
        </Link>
        <span className="text-[14px] font-medium truncate">{submissionName}</span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--ink-2)] mono">
          <span className={`h-1.5 w-1.5 rounded-full ${isReady ? "bg-[var(--mint)]" : "bg-[var(--orange)]"}`} />
          {isReady ? "live" : "connecting..."}
        </span>
        {currentIndex >= 0 && (
          <span className="hidden sm:inline-flex rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] mono text-[var(--ink-2)]">
            {currentIndex + 1}/{submissions.length}
          </span>
        )}
        <button
          type="button"
          onClick={() => setActivityOpen((v) => !v)}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--ink-2)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]"
          aria-label={activityOpen ? "Hide agent activity" : "Show agent activity"}
          title={activityOpen ? "Hide agent activity" : "Show agent activity"}
        >
          {activityOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
        <button
          type="button"
          onClick={() => void deleteCurrentSubmission()}
          disabled={deleting}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--ink-2)] hover:bg-[color-mix(in_oklab,var(--red)_10%,white)] hover:text-[#7a1b22] disabled:opacity-50"
          aria-label="Delete current submission"
          title="Delete submission"
        >
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
        <button onClick={savePdf} disabled={saving}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--line)] text-[12.5px] hover:bg-[var(--surface-soft)] disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Save as PDF
        </button>
      </header>

      <div className="flex-1 min-h-0 flex">
        <div ref={surfaceRef} className="flex-1 min-w-0">
          <SurfaceCanvas
            key={surfaceScope}
            channel={surfaceScope}
            agentId={AGENT_ID}
            acceptedSurfaceIds={[reviewSurfaceId, finalSurfaceId]}
            emptyState={
              <CanvasEmptyState
                title="Marking..."
                subtitle={reviewError ?? "Running the frozen tests against this submission and preparing the evidence."}
                hint={reviewError ? null : <Loader2 className="animate-spin text-[var(--ink-2)]" />}
              />
            }
          />
        </div>

        {activityOpen && (
          <aside className="w-80 shrink-0 border-l border-[var(--line)] bg-[var(--surface)] flex flex-col marking-activity copilot-chat-wrapper">
            <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--line)]">
              <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-2)]">
                Agent activity
              </span>
              <button
                type="button"
                onClick={() => setActivityOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-2)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]"
                aria-label="Hide agent activity"
                title="Hide agent activity"
              >
                <PanelRightClose size={14} />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <CopilotChat
                agentId={AGENT_ID}
                threadId={reviewThreadId}
                labels={{
                  chatInputPlaceholder: "Ask a follow-up (optional)...",
                  welcomeMessageText: "Marking this submission against the frozen tests...",
                }}
              />
            </div>
          </aside>
        )}
      </div>

      {nextSubmission && (
        <footer className="shrink-0 border-t border-[var(--line)] bg-[var(--surface)] px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-2)]">
              Submission queue
            </div>
            <div className="truncate text-[12.5px] text-[var(--ink-2)]">
              {currentIndex >= 0 ? `Current ${currentIndex + 1} of ${submissions.length}. ` : ""}
              Next: <span className="font-medium text-[var(--ink)]">{nextSubmission.name}</span>
            </div>
          </div>
          <Link
            href={`/a/${workspaceId}/s/${nextSubmission.id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--ink)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#1d1d23]"
          >
            Next Submission <ArrowRight size={15} />
          </Link>
        </footer>
      )}
    </div>
  );
}

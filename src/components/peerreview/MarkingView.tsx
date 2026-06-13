"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CopilotChat, useAgent } from "@copilotkit/react-core/v2";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
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
  const { agent } = useAgent({ agentId: AGENT_ID });
  const isReady = Boolean(agent);
  const startedRef = useRef(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);

  useEffect(() => {
    surfaceBus.reset(AGENT_ID);
    startedRef.current = false;
  }, [submissionId]);

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
    if (!agent || startedRef.current) return;
    startedRef.current = true;
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: `Call review_submission with workspace_id="${workspaceId}" and submission_id="${submissionId}".`,
    });
    window.setTimeout(() => {
      void agent.runAgent().catch((e) => console.warn("[marking] runAgent failed", e));
    }, 50);
  }, [agent, workspaceId, submissionId]);

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
        <button onClick={savePdf} disabled={saving}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--line)] text-[12.5px] hover:bg-[var(--surface-soft)] disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Save as PDF
        </button>
      </header>

      <div className="flex-1 min-h-0 flex">
        <div ref={surfaceRef} className="flex-1 min-w-0">
          <SurfaceCanvas
            key={`${AGENT_ID}:${submissionId}`}
            channel={AGENT_ID}
            emptyState={
              <CanvasEmptyState
                title="Marking..."
                subtitle="Running the frozen tests against this submission and preparing the evidence."
                hint={<Loader2 className="animate-spin text-[var(--ink-2)]" />}
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
        <footer className="shrink-0 border-t border-[var(--line)] bg-[var(--surface)] px-4 py-3 flex items-center justify-end">
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

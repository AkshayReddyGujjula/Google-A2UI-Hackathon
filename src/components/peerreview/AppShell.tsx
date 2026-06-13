"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FolderClosed, Plus } from "lucide-react";
import { api, type WorkspaceSummary } from "@/lib/peerreview-api";
import { CreateAssignmentWizard } from "./CreateAssignmentWizard";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 px-1">
      <span
        aria-hidden
        className="inline-flex items-center justify-center rounded-lg"
        style={{ width: 26, height: 26, background: "var(--brand-gradient)" }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0a0a0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      </span>
      <span className="font-semibold tracking-tight text-[15px] text-[var(--ink)]">
        PeerReview<span className="text-[var(--lilac)]">.ai</span>
      </span>
    </Link>
  );
}

export function AppShell({ activeId, children }: { activeId?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);

  const refresh = useCallback(() => {
    api.listAssignments().then(setWorkspaces).catch(() => setWorkspaces([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="h-screen flex bg-[var(--bg)] text-[var(--ink)]">
      <aside className="w-64 shrink-0 border-r border-[var(--line)] bg-[var(--surface)] flex flex-col">
        <div className="h-14 flex items-center px-3 border-b border-[var(--line)]">
          <Logo />
        </div>
        <div className="p-3">
          <button
            onClick={() => setWizardOpen(true)}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--ink)] text-white text-[13px] font-medium hover:bg-[#1d1d23] transition"
          >
            <Plus size={16} /> New assignment
          </button>
        </div>
        <div className="px-3 pb-2 mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink-2)]">
          Assignments
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-0.5">
          {workspaces.length === 0 && (
            <p className="px-2 py-3 text-[12.5px] text-[var(--ink-2)] leading-snug">
              No assignments yet. Create one to get started.
            </p>
          )}
          {workspaces.map((w) => (
            <Link
              key={w.id}
              href={`/a/${w.id}`}
              className={`group flex items-start gap-2 px-2.5 py-2 rounded-lg transition ${
                activeId === w.id ? "bg-[var(--surface-soft)]" : "hover:bg-[var(--surface-soft)]"
              }`}
            >
              <FolderClosed size={16} className="mt-0.5 shrink-0 text-[var(--lilac)]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium truncate">{w.title}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-[var(--ink-2)]">
                  <span className={`h-1.5 w-1.5 rounded-full ${w.status === "frozen" ? "bg-[var(--mint)]" : "bg-[var(--orange)]"}`} />
                  {w.status === "frozen" ? "ready" : "draft"} · {w.marked_count}/{w.submission_count} marked
                </span>
              </span>
              {w.submission_count > 0 && w.marked_count === w.submission_count && (
                <CheckCircle2 size={14} className="mt-0.5 text-[var(--mint)]" />
              )}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="flex-1 min-w-0 overflow-hidden">{children}</main>

      {wizardOpen && (
        <CreateAssignmentWizard
          onClose={() => setWizardOpen(false)}
          onCreated={(id) => {
            setWizardOpen(false);
            refresh();
            router.push(`/a/${id}`);
          }}
        />
      )}
    </div>
  );
}

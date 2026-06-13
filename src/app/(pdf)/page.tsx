"use client";

import { AppShell } from "@/components/peerreview/AppShell";

export default function Home() {
  return (
    <AppShell>
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "var(--brand-gradient)" }} aria-hidden>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0a0a0b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--ink)]">Mark assignments, fairly and fast</h1>
          <p className="text-[14px] text-[var(--ink-2)] leading-relaxed">
            Create an assignment from your brief, then drop in student submissions to mark them with
            evidence and human-approved feedback.
          </p>
          <p className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-2)] mt-1">
            ← Click “New assignment” to start
          </p>
        </div>
      </div>
    </AppShell>
  );
}

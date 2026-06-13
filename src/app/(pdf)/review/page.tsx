"use client";

import { useRef, useState } from "react";
import { z } from "zod";
import { CopilotChat, useAgent, useRenderTool } from "@copilotkit/react-core/v2";
import { SiteNav } from "@/components/pdf-analyst/Brand";
import { SurfaceCanvas, CanvasEmptyState } from "@/components/pdf-analyst/SurfaceCanvas";
import { Split } from "@/components/pdf-analyst/Split";

const AGENT_ID = "review_agent";

function ComposingPill({ label }: { label: string }) {
  return (
    <div className="surface-soft px-3 py-2 my-1 flex items-center gap-3 text-[13px] text-[var(--ink-2)]">
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--lilac)] opacity-75 animate-ping" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--lilac)]" />
      </span>
      <span>{label}</span>
    </div>
  );
}

export default function ReviewPage() {
  const { agent } = useAgent({ agentId: AGENT_ID });
  const [ghUrl, setGhUrl] = useState("");
  const [uploaded, setUploaded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  for (const name of ["review_submission", "finalize_feedback", "manage_calibration"]) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useRenderTool({
      name,
      parameters: z.any(),
      render: ({ status }) => (status === "complete" ? <></> : <ComposingPill label="Working…" />),
    });
  }

  const send = (content: string) => {
    if (!agent) return;
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content });
    void agent.runAgent().catch((e) => console.warn("[review] runAgent failed", e));
  };

  const onFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.name.endsWith(".py"));
    if (!files.length) return;
    const obj: Record<string, string> = {};
    for (const f of files.slice(0, 40)) {
      const rel: string = f.webkitRelativePath || f.name;
      obj[rel.split("/").slice(1).join("/") || f.name] = await f.text();
    }
    setUploaded(`${files.length} .py file(s)`);
    send(
      "Review this uploaded folder. Use source_type=\"pasted\" with this pasted_files_json:\n```json\n" +
        JSON.stringify(obj) +
        "\n```",
    );
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)]">
      <SiteNav active="review" />
      <div className="flex-1 min-h-0 flex">
        <Split
          persistKey="review.split"
          initialLeftFraction={0.34}
          left={
            <div className="h-full flex flex-col copilot-chat-wrapper">
              <div className="shrink-0 px-4 py-3 border-b border-[var(--line)] flex flex-col gap-2 bg-[color-mix(in_oklab,var(--lilac)_6%,var(--surface))]">
                <div className="flex items-center gap-2">
                  <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink)]">Phase 2 · Review</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    data-testid="load-dfs"
                    onClick={() => send("Review the seeded submission submission-dfs.")}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[var(--ink)] text-white hover:bg-[#1d1d23] mono"
                  >
                    Seeded: DFS submission
                  </button>
                  <button
                    onClick={() => send("Review the seeded submission submission-bfs-correct.")}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--surface-soft)] mono"
                  >
                    Seeded: correct BFS
                  </button>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--surface-soft)] mono"
                  >
                    Upload folder…
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    // @ts-expect-error non-standard directory attributes
                    webkitdirectory=""
                    directory=""
                    multiple
                    className="hidden"
                    onChange={onFolder}
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    value={ghUrl}
                    onChange={(e) => setGhUrl(e.target.value)}
                    placeholder="public GitHub repo URL"
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[12px] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] mono"
                  />
                  <button
                    onClick={() => ghUrl.trim() && send(`Review this public GitHub repo: ${ghUrl.trim()}`)}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--surface-soft)] mono"
                  >
                    Review repo
                  </button>
                </div>
                {uploaded && <span className="text-[11px] text-[var(--ink-2)]">uploaded: {uploaded}</span>}
              </div>
              <div className="flex-1 min-h-0">
                <CopilotChat
                  agentId={AGENT_ID}
                  labels={{
                    chatInputPlaceholder: "Ask the review agent… or load a submission above",
                    welcomeMessageText:
                      "Load a student submission (seeded, uploaded folder, or a public GitHub repo). I'll run the frozen tests for real, detect the misconception, draw the traversal, and propose scores — you approve every final mark.",
                  }}
                />
              </div>
            </div>
          }
          right={
            <SurfaceCanvas
              channel={AGENT_ID}
              emptyState={
                <CanvasEmptyState
                  title="No submission loaded"
                  subtitle="Load a submission on the left. The agent runs the frozen tests, detects the misconception, draws BFS layers vs the student's path, and proposes evidence-based scores for your approval."
                  hint={<span className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">freeze a workspace on Setup first</span>}
                />
              }
            />
          }
        />
      </div>
    </div>
  );
}

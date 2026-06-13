"use client";

import { z } from "zod";
import { CopilotChat, useAgent, useRenderTool } from "@copilotkit/react-core/v2";
import { SiteNav } from "@/components/pdf-analyst/Brand";
import { SurfaceCanvas, CanvasEmptyState } from "@/components/pdf-analyst/SurfaceCanvas";
import { Split } from "@/components/pdf-analyst/Split";

const AGENT_ID = "setup_agent";

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

export default function SetupPage() {
  const { agent } = useAgent({ agentId: AGENT_ID });

  useRenderTool({
    name: "setup_workspace",
    parameters: z.any(),
    render: ({ status }) => (status === "complete" ? <></> : <ComposingPill label="Building workspace…" />),
  });
  useRenderTool({
    name: "freeze_workspace",
    parameters: z.any(),
    render: ({ status }) => (status === "complete" ? <></> : <ComposingPill label="Freezing workspace…" />),
  });

  const send = (content: string) => {
    if (!agent) return;
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content });
    void agent.runAgent().catch((e) => console.warn("[setup] runAgent failed", e));
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)]">
      <SiteNav active="setup" />
      <div className="flex-1 min-h-0 flex">
        <Split
          persistKey="setup.split"
          initialLeftFraction={0.34}
          left={
            <div className="h-full flex flex-col copilot-chat-wrapper">
              <div className="shrink-0 px-4 py-3 border-b border-[var(--line)] flex flex-wrap items-center gap-2 bg-[color-mix(in_oklab,var(--lilac)_6%,var(--surface))]">
                <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink)]">Phase 1 · Setup</span>
                <button
                  data-testid="load-assignment"
                  onClick={() => send("Set up the marking workspace for the seeded BFS shortest-path assignment.")}
                  className="ml-auto px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-[var(--ink)] text-white hover:bg-[#1d1d23] mono"
                >
                  Load BFS assignment →
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <CopilotChat
                  agentId={AGENT_ID}
                  labels={{
                    chatInputPlaceholder: "Ask the setup agent… or click 'Load BFS assignment'",
                    welcomeMessageText:
                      "Click “Load BFS assignment” to build a marking workspace. I'll structure the rubric, pull a LinkUp reference, generate a test suite, and validate it against a reference solution before you approve & freeze it.",
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
                  title="No workspace yet"
                  subtitle="Load an assignment in the chat. The agent will compose the setup surface — assignment summary, rubric, LinkUp reference, the validated test suite, and an approval gate — and render it here."
                  hint={<span className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">then: approve &amp; freeze</span>}
                />
              }
            />
          }
        />
      </div>
    </div>
  );
}

import Link from "next/link";
import { SiteNav, PageHeader } from "@/components/pdf-analyst/Brand";

export default function Home() {
  return (
    <>
      <SiteNav active="home" />
      <PageHeader
        eyebrow="CopilotKit × AG-UI × A2UI × LinkUp"
        meta={
          <span className="pill">
            <span className="dot" /> human-in-the-loop marking
          </span>
        }
        title={
          <>
            A marking cockpit that the agent{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--brand-gradient)" }}
            >
              generates for each submission.
            </span>
          </>
        }
        subtitle="PeerReview.ai turns CS assignment marking into an agentic, evidence-based workflow. A TA freezes a rubric + validated test suite, then the agent runs the real tests against a student repo, detects the misconception, draws the traversal, and proposes scores — every final mark gated by human approval."
      />

      <main className="flex-1 max-w-[1320px] mx-auto px-6 py-12 w-full">
        <div className="grid md:grid-cols-2 gap-5">
          <ModeCard
            href="/setup"
            badge="PHASE 1 · SETUP"
            title="Build & freeze a workspace"
            blurb="Load an assignment. The agent structures the rubric, pulls source-grounded reference context from LinkUp, and generates a test suite — then validates it against a trusted reference solution before you approve and freeze it."
            bullets={[
              "Tests are validated against a reference solution before freezing",
              "Graph-search tests assert path properties, not one exact path",
              "LinkUp reference is explanation-only — it never affects scores",
            ]}
            cta="Open Setup"
          />
          <ModeCard
            href="/review"
            badge="PHASE 2 · REVIEW"
            title="Mark a submission"
            blurb="Load a submission (seeded folder, pasted code, or a public GitHub repo). The agent runs the frozen tests for real, detects the misconception, draws BFS layers vs the student's path, proposes evidence-based scores, and surfaces calibration memory — you approve."
            bullets={[
              "Real pytest execution against the frozen suite",
              "Visual BFS-vs-DFS traversal trace (deterministic, not hallucinated)",
              "Edit a score → feedback regenerates → you approve",
            ]}
            cta="Open Review"
          />
        </div>

        <section className="mt-14 grid md:grid-cols-4 gap-3">
          <Spec k="CopilotKit + AG-UI" v="Live agent↔frontend loop, streaming surfaces, A2UI actions back to the agent" />
          <Spec k="A2UI" v="Declarative generative UI — the agent composes the cockpit from a trusted catalog" />
          <Spec k="LinkUp" v="Source-grounded reference context for TA-facing explanations" />
          <Spec k="Human-in-the-loop" v="Approval gates on the frozen workspace and every final mark" />
        </section>

        <section className="mt-12">
          <div className="flex items-end justify-between mb-4">
            <div>
              <span className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted-2)]">
                The design system
              </span>
              <h2 className="text-[22px] font-semibold tracking-tight mt-1">
                A controlled A2UI catalog
              </h2>
            </div>
            <Link href="/catalog" className="mono text-[12px] text-[var(--ink)] hover:text-[var(--lilac)] transition">
              See the primitives →
            </Link>
          </div>
          <p className="text-[14px] text-[var(--muted)] max-w-3xl leading-relaxed">
            The agent never emits raw UI code. It selects from a fixed catalog — layout/text/data
            primitives plus PeerReview panels like <code className="mono">VisualGraphTracePanel</code>,{" "}
            <code className="mono">MisconceptionPanel</code>, <code className="mono">TestResultsPanel</code>,
            and an interactive <code className="mono">GradeApprovalPanel</code>.
          </p>
        </section>
      </main>

      <footer className="border-t border-[var(--line)] py-6 mt-10">
        <div className="max-w-[1320px] mx-auto px-6 text-xs text-[var(--muted)] flex items-center justify-between">
          <span>PeerReview.ai — Generative UI Hackathon Track</span>
          <span className="mono">human-controlled marking</span>
        </div>
      </footer>
    </>
  );
}

function ModeCard({
  href,
  badge,
  title,
  blurb,
  bullets,
  cta,
}: {
  href: string;
  badge: string;
  title: string;
  blurb: string;
  bullets: string[];
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group surface p-7 hover:border-[var(--lilac)] transition relative overflow-hidden"
    >
      <div className="absolute -top-20 -right-20 w-[260px] h-[260px] rounded-full brand-gradient-soft opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative">
        <span className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted-2)]">
          {badge}
        </span>
        <h3 className="text-[24px] font-semibold tracking-tight mt-2">{title}</h3>
        <p className="mt-3 text-[var(--muted)] leading-relaxed text-[15px]">{blurb}</p>
        <ul className="mt-5 space-y-2">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-[13.5px] text-[var(--ink-2)]">
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[var(--lilac)] flex-none" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[var(--ink)] transition mono">
          {cta} <span aria-hidden>→</span>
        </span>
      </div>
    </Link>
  );
}

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div className="surface-soft p-4">
      <div className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted-2)]">{k}</div>
      <div className="mt-1 text-[13px] text-[var(--ink-2)]">{v}</div>
    </div>
  );
}

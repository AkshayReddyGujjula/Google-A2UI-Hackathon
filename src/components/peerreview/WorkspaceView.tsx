"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown, FilePlus2, Github, Loader2, Lock, Plus, RefreshCw, Trash2,
} from "lucide-react";
import {
  api, type Assignment, type SubmissionSummary,
} from "@/lib/peerreview-api";

export function WorkspaceView({ id }: { id: string }) {
  const router = useRouter();
  const [a, setA] = useState<Assignment | null>(null);
  const [subs, setSubs] = useState<SubmissionSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const load = () => {
    api.getAssignment(id).then(setA).catch((e) => setErr(String(e.message || e)));
    api.listSubmissions(id).then(setSubs).catch(() => {});
  };
  useEffect(load, [id]);

  if (err) return <Centered>{err}</Centered>;
  if (!a) return <Centered><Loader2 className="animate-spin" /> Loading…</Centered>;

  const totalMax = a.rubric.criteria.reduce((s, c) => s + (Number(c.max) || 0), 0);

  const setCriterion = (i: number, patch: Partial<Assignment["rubric"]["criteria"][number]>) =>
    setA({ ...a, rubric: { ...a.rubric, criteria: a.rubric.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) } });
  const addCriterion = () =>
    setA({
      ...a,
      rubric: {
        ...a.rubric,
        criteria: [
          ...a.rubric.criteria,
          {
            id: `criterion_${a.rubric.criteria.length + 1}`,
            label: "New criterion",
            description: "Describe what earns these marks.",
            kind: "correctness",
            max: 1,
          },
        ],
      },
    });
  const removeCriterion = (i: number) =>
    setA({ ...a, rubric: { ...a.rubric, criteria: a.rubric.criteria.filter((_, j) => j !== i) } });
  const toggleTest = (i: number) =>
    setA({ ...a, tests: a.tests.map((t, j) => (j === i ? { ...t, selected: !t.selected } : t)) });

  const finalize = async () => {
    setBusy("Finalizing…");
    try {
      await api.patchAssignment(id, { rubric: a.rubric, tests: a.tests });
      const frozen = await api.freezeAssignment(id);
      setA(frozen);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async () => {
    setBusy("Regenerating tests…");
    try {
      setA(await api.regenerateTests(id));
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <header className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink-2)]">{a.assignment_type}</span>
              <span className={`inline-flex items-center gap-1 text-[11px] mono ${a.status === "frozen" ? "text-[#0a5d44]" : "text-[#7a3f0f]"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${a.status === "frozen" ? "bg-[var(--mint)]" : "bg-[var(--orange)]"}`} />
                {a.status === "frozen" ? "finalized" : "draft"}
              </span>
            </div>
            <h1 className="text-[22px] font-semibold tracking-tight">{a.title}</h1>
          </div>
          {a.status === "draft" && (
            <button onClick={finalize} disabled={!!busy}
                    className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--ink)] text-white text-[13px] font-medium hover:bg-[#1d1d23] disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />} Finalize
            </button>
          )}
        </header>

        {/* Rubric */}
        <Section title="Rubric" right={<span className="mono text-[12px] text-[var(--ink-2)]">total {totalMax}</span>}>
          <div className="flex flex-col gap-2">
            {a.rubric.criteria.map((c, i) => (
              <div key={c.id} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 flex gap-3">
                <div className="flex-1 min-w-0">
                  {a.status === "draft" ? (
                    <div className="flex flex-col gap-2">
                      <input value={c.label} onChange={(e) => setCriterion(i, { label: e.target.value })}
                             className="w-full bg-transparent text-[14px] font-medium outline-none" />
                      <textarea value={c.description ?? ""} onChange={(e) => setCriterion(i, { description: e.target.value })}
                                className="min-h-14 w-full resize-y rounded-md border border-[var(--line)] bg-[var(--surface-soft)] px-2.5 py-1.5 text-[12px] text-[var(--ink-2)] leading-snug outline-none focus:border-[var(--lilac)]" />
                      <select value={c.kind} onChange={(e) => setCriterion(i, { kind: e.target.value })}
                              className="w-fit rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-[11.5px] mono text-[var(--ink-2)]">
                        <option value="correctness">correctness</option>
                        <option value="algorithmic_understanding">algorithmic understanding</option>
                        <option value="edge_cases">edge cases</option>
                        <option value="code_quality">code quality</option>
                      </select>
                    </div>
                  ) : (
                    <>
                      <div className="text-[14px] font-medium">{c.label}</div>
                      <div className="text-[12px] text-[var(--ink-2)] leading-snug mt-0.5">{c.description}</div>
                    </>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  {a.status === "draft" ? (
                    <input type="number" min={0} value={c.max}
                           onChange={(e) => setCriterion(i, { max: Number(e.target.value) })}
                           className="w-14 text-center rounded-md border border-[var(--line)] bg-[var(--surface)] py-1 text-[13px] mono" />
                  ) : (
                    <span className="mono text-[13px]">{c.max}</span>
                  )}
                  <span className="mono text-[12px] text-[var(--ink-2)]">pts</span>
                  {a.status === "draft" && a.rubric.criteria.length > 1 && (
                    <button type="button" onClick={() => removeCriterion(i)}
                            className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line)] text-[var(--ink-2)] hover:text-[#7a1b22] hover:bg-[color-mix(in_oklab,var(--red)_8%,white)]"
                            aria-label={`Remove ${c.label}`}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {a.status === "draft" && (
              <button type="button" onClick={addCriterion}
                      className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-[12.5px] text-[var(--ink-2)] hover:border-[var(--lilac)] hover:text-[var(--ink)]">
                <Plus size={14} /> Add rubric criterion
              </button>
            )}
          </div>
        </Section>

        {/* Tests */}
        <Section
          title="Tests"
          right={a.status === "draft" ? (
            <button onClick={regenerate} disabled={!!busy} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ink-2)] hover:text-[var(--ink)]">
              <RefreshCw size={13} className={busy === "Regenerating tests…" ? "animate-spin" : ""} /> Regenerate
            </button>
          ) : <span className="mono text-[12px] text-[var(--ink-2)]">{a.tests.filter((t) => t.selected).length} checks</span>}
        >
          <div className="flex flex-col gap-1">
            {a.tests.map((t, i) => (
              <label key={t.name} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] cursor-pointer">
                <input type="checkbox" checked={t.selected} disabled={a.status !== "draft"} onChange={() => toggleTest(i)} />
                <span className="text-[13px] flex-1">{t.name}</span>
                <span className="mono text-[10px] uppercase tracking-wide text-[var(--ink-2)]">{t.kind}</span>
              </label>
            ))}
          </div>
        </Section>

        {/* Advanced */}
        <button onClick={() => setAdvanced((v) => !v)} className="flex items-center gap-1.5 text-[12.5px] text-[var(--ink-2)] hover:text-[var(--ink)] mb-2">
          <ChevronDown size={15} className={`transition ${advanced ? "rotate-180" : ""}`} /> Advanced (reference solution, sources)
        </button>
        {advanced && (
          <div className="mb-5 flex flex-col gap-3">
            {a.reference && (a.reference.answer || (a.reference.sources?.length ?? 0) > 0) && (
              <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
                <div className="mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-2)] mb-1">LinkUp reference · explanation only</div>
                <p className="text-[12.5px] text-[var(--ink-2)] leading-snug">{a.reference.answer}</p>
              </div>
            )}
            {a.reference_solution && (
              <pre className="rounded-lg border border-[var(--line)] bg-[#0f0f17] text-[#e6e6f0] text-[12px] leading-[1.55] mono overflow-x-auto p-3">
                {a.reference_solution}
              </pre>
            )}
          </div>
        )}

        {/* Submissions (frozen only) */}
        {a.status === "frozen" && (
          <Section title="Submissions" right={<span className="mono text-[12px] text-[var(--ink-2)]">{subs.length}</span>}>
            <SubmissionAdder id={id} onAdded={(sid) => router.push(`/a/${id}/s/${sid}`)} onError={setErr} />
            <div className="mt-3 flex flex-col gap-1">
              {subs.length === 0 && <p className="text-[12.5px] text-[var(--ink-2)] px-1">No submissions yet. Add one above to start marking.</p>}
              {subs.map((s) => (
                <Link key={s.id} href={`/a/${id}/s/${s.id}`}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] hover:border-[var(--lilac)] transition">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${
                    s.status === "approved" ? "bg-[var(--mint)]" : s.status === "error" ? "bg-[var(--red)]" : s.status === "reviewed" ? "bg-[var(--lilac)]" : "bg-[var(--ink-2)]"
                  }`} />
                  <span className="text-[13px] font-medium flex-1 truncate">{s.name}</span>
                  <span className="mono text-[11px] text-[var(--ink-2)]">{s.status}</span>
                  {s.total != null && <span className="mono text-[12px] font-medium">{s.total}/{s.max_total}</span>}
                </Link>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex items-center justify-center gap-2 text-[14px] text-[var(--ink-2)]">{children}</div>;
}

function SubmissionAdder({ id, onAdded, onError }: { id: string; onAdded: (sid: string) => void; onError: (m: string) => void }) {
  const [tab, setTab] = useState<"folder" | "paste" | "github">("folder");
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState("");
  const [name, setName] = useState("");
  const [gh, setGh] = useState("");
  const folderRef = useRef<HTMLInputElement>(null);

  const add = async (body: Parameters<typeof api.addSubmission>[1]) => {
    setBusy(true);
    try {
      const sub = await api.addSubmission(id, body);
      onAdded(sub.id);
    } catch (e) {
      onError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const onFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.name.endsWith(".py")).slice(0, 40);
    if (!files.length) return onError("Pick a folder containing at least one .py file.");
    const obj: Record<string, string> = {};
    for (const f of files) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      obj[rel.split("/").slice(1).join("/") || f.name] = await f.text();
    }
    const folderName = ((files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || "").split("/")[0];
    await add({ name: folderName || "submission", source_type: "pasted", pasted_files_json: JSON.stringify(obj) });
    if (folderRef.current) folderRef.current.value = "";
  };

  const Tab = ({ k, label }: { k: typeof tab; label: string }) => (
    <button onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-[12px] ${tab === k ? "bg-[var(--ink)] text-white" : "border border-[var(--line)] text-[var(--ink-2)] hover:bg-[var(--surface-soft)]"}`}>
      {label}
    </button>
  );

  return (
    <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] p-3">
      <div className="flex gap-2 mb-2">
        <Tab k="folder" label="Upload folder" />
        <Tab k="paste" label="Paste code" />
        <Tab k="github" label="GitHub URL" />
        {busy && <Loader2 size={16} className="animate-spin self-center text-[var(--ink-2)]" />}
      </div>
      {tab === "folder" && (
        <button onClick={() => folderRef.current?.click()} disabled={busy}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[12.5px] hover:border-[var(--lilac)]">
          <FilePlus2 size={15} /> Choose a student folder
          <input ref={folderRef} type="file" multiple
                 // @ts-expect-error directory attrs
                 webkitdirectory="" directory="" className="hidden" onChange={onFolder} />
        </button>
      )}
      {tab === "paste" && (
        <div className="flex flex-col gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="student name (optional)"
                 className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[12.5px]" />
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="paste the student's solution.py here"
                    className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-[12px] mono h-32" />
          <button onClick={() => paste.trim() && add({ name: name || "pasted submission", source_type: "pasted", pasted_files_json: JSON.stringify({ "solution.py": paste }) })}
                  disabled={busy || !paste.trim()} className="self-start px-3 py-1.5 rounded-lg bg-[var(--ink)] text-white text-[12.5px] disabled:opacity-50">
            Add submission
          </button>
        </div>
      )}
      {tab === "github" && (
        <div className="flex gap-2">
          <input value={gh} onChange={(e) => setGh(e.target.value)} placeholder="https://github.com/user/repo"
                 className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[12.5px] mono" />
          <button onClick={() => gh.trim() && add({ name: gh.split("/").slice(-1)[0], source_type: "github", github_url: gh.trim() })}
                  disabled={busy || !gh.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ink)] text-white text-[12.5px] disabled:opacity-50">
            <Github size={14} /> Add
          </button>
        </div>
      )}
    </div>
  );
}

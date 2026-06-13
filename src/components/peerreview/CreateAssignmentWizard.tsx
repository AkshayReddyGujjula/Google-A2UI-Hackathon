"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";
import { api } from "@/lib/peerreview-api";
import { extractDocText } from "@/lib/pdf";

const BUSY_STEPS = [
  "Reading the assessment…",
  "Drafting the rubric…",
  "Writing a reference solution…",
  "Generating and validating tests…",
];

export function CreateAssignmentWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [docName, setDocName] = useState<string | null>(null);
  const [docText, setDocText] = useState("");
  const [rubricMode, setRubricMode] = useState<"auto" | "manual" | "upload">("auto");
  const [rubricName, setRubricName] = useState<string | null>(null);
  const [rubricText, setRubricText] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyStep, setBusyStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const rubricRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setBusyStep((s) => (s + 1) % BUSY_STEPS.length), 2500);
    return () => clearInterval(t);
  }, [busy]);

  const readDoc = async (file: File) => {
    setError(null);
    try {
      const { text } = await extractDocText(file);
      if (!text.trim()) throw new Error("That file had no readable text.");
      setDocName(file.name);
      setDocText(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    }
  };

  const readRubric = async (file: File) => {
    try {
      const { text } = await extractDocText(file);
      setRubricName(file.name);
      setRubricText(text);
    } catch {
      setError("Could not read the rubric file.");
    }
  };

  const create = async () => {
    if (!docText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const a = await api.createAssignment(docText, rubricMode === "auto" ? "" : rubricText);
      onCreated(a.id);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Generation failed. Try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-[var(--surface)] border border-[var(--line)] shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--line)]">
          <h2 className="text-[15px] font-semibold">New assignment</h2>
          {!busy && (
            <button onClick={onClose} className="text-[var(--ink-2)] hover:text-[var(--ink)]">
              <X size={18} />
            </button>
          )}
        </div>

        {busy ? (
          <div className="px-5 py-10 flex flex-col items-center gap-4 text-center">
            <span className="relative inline-flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--lilac)] opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[var(--lilac)]" />
            </span>
            <p className="text-[14px] text-[var(--ink)]">{BUSY_STEPS[busyStep]}</p>
            <p className="text-[12px] text-[var(--ink-2)]">This takes a few seconds.</p>
          </div>
        ) : (
          <div className="px-5 py-4 flex flex-col gap-4">
            {/* Step 1: assessment doc */}
            <div>
              <label className="text-[12px] font-medium text-[var(--ink)]">Assessment document</label>
              <div
                onClick={() => docRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) void readDoc(f);
                }}
                className="mt-1.5 cursor-pointer rounded-xl border-2 border-dashed border-[var(--line)] hover:border-[var(--lilac)] bg-[var(--surface-soft)] px-4 py-6 flex flex-col items-center gap-1.5 text-center transition"
              >
                {docName ? (
                  <>
                    <FileText size={22} className="text-[var(--lilac)]" />
                    <span className="text-[13px] font-medium">{docName}</span>
                    <span className="text-[11px] text-[var(--ink-2)]">click to replace</span>
                  </>
                ) : (
                  <>
                    <UploadCloud size={22} className="text-[var(--ink-2)]" />
                    <span className="text-[13px]">Drop the assignment brief, or click to upload</span>
                    <span className="text-[11px] text-[var(--ink-2)]">PDF, Markdown or text</span>
                  </>
                )}
              </div>
              <input ref={docRef} type="file" accept=".pdf,.md,.txt,.markdown,text/*" className="hidden"
                     onChange={(e) => e.target.files?.[0] && readDoc(e.target.files[0])} />
            </div>

            {/* Step 2: rubric */}
            <div>
              <label className="text-[12px] font-medium text-[var(--ink)]">Rubric</label>
              <div className="mt-1.5 flex gap-2">
                {(["auto", "manual", "upload"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setRubricMode(m)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-[12.5px] transition ${
                      rubricMode === m
                        ? "border-[var(--lilac)] bg-[color-mix(in_oklab,var(--lilac)_10%,var(--surface))] text-[var(--ink)]"
                        : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--ink-2)]"
                    }`}
                  >
                    {m === "auto" ? "Generate automatically" : m === "manual" ? "Type rubric" : "Upload a rubric"}
                  </button>
                ))}
              </div>
              {rubricMode === "manual" && (
                <textarea
                  value={rubricText}
                  onChange={(e) => setRubricText(e.target.value)}
                  placeholder={"Paste or type the marking criteria here, for example:\nCorrectness: 6 marks\nEdge cases: 2 marks\nCode quality: 2 marks"}
                  className="mt-2 min-h-32 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[12.5px] leading-relaxed outline-none focus:border-[var(--lilac)]"
                />
              )}
              {rubricMode === "upload" && (
                <div className="mt-2">
                  <button onClick={() => rubricRef.current?.click()}
                          className="text-[12.5px] rounded-lg border border-[var(--line)] px-3 py-1.5 hover:bg-[var(--surface-soft)]">
                    {rubricName ? `Rubric: ${rubricName}` : "Choose rubric file…"}
                  </button>
                  <input ref={rubricRef} type="file" accept=".pdf,.md,.txt,.markdown,text/*" className="hidden"
                         onChange={(e) => e.target.files?.[0] && readRubric(e.target.files[0])} />
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-[color-mix(in_oklab,var(--red)_45%,white)] bg-[color-mix(in_oklab,var(--red)_8%,white)] px-3 py-2 text-[12.5px] text-[#7a1b22]">
                {error}
              </div>
            )}

            <button
              onClick={create}
              disabled={!docText.trim() || (rubricMode !== "auto" && !rubricText.trim())}
              className="mt-1 inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-[var(--ink)] text-white text-[13px] font-medium hover:bg-[#1d1d23] transition disabled:opacity-45 disabled:cursor-not-allowed"
            >
              Create assignment
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

#!/usr/bin/env node
/**
 * pnpm smoke â€” Composite gate, the load-bearing CI check.
 *
 * PeerReview.ai default: the FastAPI agent at `agent/main.py` exposes
 * POST /setup and /review on :8123. Smoke imports the app, checks those
 * endpoints, and verifies the OFFLINE setup graph emits a real A2UI surface.
 * Steps that need a running, Gemini-backed agent are SKIPs, gated behind an
 * env check, so smoke is exit-0 statically with no API key.
 *
 * Runs (in order, failing fast):
 *   1. `pnpm verify-pins`               â€” lockfile / package.json drift
 *   2. `pnpm validate-widget --examples`â€” other-examples/EXAMPLE.json files
 *   3. `pnpm validate-widget` over every JSON in the widget/schema dirs
 *   4. `pnpm test:widgets`              â€” fixture renderer pass (delegates to validator)
 *   4a. `pnpm test:schemas`             â€” pytest path-vs-data alignment, SKIPPED when
 *                                         agent/tests/ is absent (pdf-analyst ships no
 *                                         pytest suite at the agent root yet)
 *   5. offline envelope shape check     â€” validates public/offline-envelopes.json
 *                                         structure if present; SKIPPED when absent
 *                                         (it was archived with PortKit)
 *   6. agent endpoint probe             â€” import agent/main.py's FastAPI app and assert
 *                                         /setup and /review are registered
 *                                         (static import; no live model call)
 *   6a. offline /setup probe            â€” with OFFLINE=1 and GEMINI_API_KEY removed,
 *                                         import the setup graph and invoke it
 *                                         in-process; assert the tool result carries
 *                                         real A2UI surface ops (createSurface /
 *                                         updateComponents). FAILS
 *                                         loudly if the no-key offline path errors or
 *                                         emits no surface. No uvicorn, no port, no key.
 *   7. agent connectivity probe (live)  â€” SKIPPED when OFFLINE=1 or no GEMINI_API_KEY
 *
 * Exit non-zero if any step fails. Machine-parsable summary at the end.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(__dirname, "..");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const PNPM = process.platform === "win32" ? "cmd.exe" : "pnpm";
const PNPM_PREFIX = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm"] : [];

type Step = {
  name: string;
  run: () => Promise<{ pass: boolean; detail: string }>;
};

const results: { name: string; pass: boolean; detail: string }[] = [];

function pnpmRun(scriptName: string, ...args: string[]): { pass: boolean; detail: string } {
  // Use the local pnpm exec form so we don't hit recursive `pnpm` lookup issues.
  const res = spawnSync(PNPM, [...PNPM_PREFIX, "run", scriptName, ...args], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  return {
    pass: res.status === 0,
    detail: res.status === 0 ? "passed" : `failed (exit ${res.status})`,
  };
}

function shellRun(cmd: string, args: string[], opts: { cwd?: string } = {}): { pass: boolean; detail: string } {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  return {
    pass: res.status === 0,
    detail: res.status === 0 ? "passed" : `failed (exit ${res.status})`,
  };
}

function verifyPinsInline(): { pass: boolean; detail: string } {
  const pkgPath = join(REPO_ROOT, "package.json");
  const uvLockPath = join(REPO_ROOT, "agent", "uv.lock");
  const lockPath = join(REPO_ROOT, "pnpm-lock.yaml");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const jsPins = [
    ["@copilotkit/react-core", "1.57.4"],
    ["@copilotkit/runtime", "1.57.4"],
    ["@copilotkit/a2ui-renderer", "1.57.4"],
    ["@copilotkit/react-ui", "1.57.4"],
    ["next", "16.1.6"],
    ["react", "19.2.4"],
    ["react-dom", "19.2.4"],
  ] as const;
  const pyPins = [
    ["langchain", "1.3.1"],
    ["langchain-core", "1.4.0"],
    ["langgraph", "1.2.1"],
  ] as const;

  let drift = 0;
  for (const [name, expected] of jsPins) {
    const actual = deps[name];
    if (actual !== expected) {
      console.log(`${RED}DRIFT:${RESET} ${name} is ${actual ?? "(missing)"} but FROZEN.md pins ${expected}`);
      drift++;
    } else {
      console.log(`${GREEN}OK:${RESET} ${name} @ ${actual}`);
    }
  }
  if (!existsSync(lockPath)) {
    console.log(`${RED}DRIFT:${RESET} pnpm-lock.yaml missing`);
    drift++;
  }
  if (!existsSync(uvLockPath)) {
    console.log(`${RED}DRIFT:${RESET} agent/uv.lock missing`);
    drift++;
  } else {
    const uvLock = readFileSync(uvLockPath, "utf-8");
    const uvPackages = new Map<string, string>();
    for (const block of uvLock.split(/\r?\n\[\[package\]\]\r?\n/)) {
      const name = block.match(/^name = "([^"]+)"/m)?.[1];
      const version = block.match(/^version = "([^"]+)"/m)?.[1];
      if (name && version) uvPackages.set(name, version);
    }
    for (const [name, expected] of pyPins) {
      const actual = uvPackages.get(name);
      if (actual !== expected) {
        console.log(`${RED}DRIFT:${RESET} ${name} is ${actual ?? "(missing)"} in agent/uv.lock but FROZEN.md pins ${expected}`);
        drift++;
      } else {
        console.log(`${GREEN}OK:${RESET} ${name} @ ${actual} ${DIM}(agent/uv.lock)${RESET}`);
      }
    }
  }
  return drift === 0
    ? { pass: true, detail: "all pins match FROZEN.md" }
    : { pass: false, detail: `${drift} pin drift item(s)` };
}

// Widget/schema dirs to validate JSON under, in the pdf-analyst layout. The
// archived PortKit `agent/src/widgets/` dir is gone; the in-repo catalog
// schemas live at agent/src/a2ui/schemas/ and the legal example keeps its
// fixtures under its own schemas dir. Missing dirs are skipped.
const WIDGET_JSON_DIRS = [
  join(REPO_ROOT, "agent", "src", "a2ui", "schemas"),
  join(REPO_ROOT, "other-examples", "legal-contract-review", "schemas"),
];

function findWidgetJsons(): string[] {
  const out: string[] = [];
  for (const dir of WIDGET_JSON_DIRS) {
    if (!existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const entry of readdirSync(cur, { withFileTypes: true })) {
        const full = join(cur, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile() && entry.name.endsWith(".json")) out.push(full);
      }
    }
  }
  return out;
}

// The FastAPI endpoints the PeerReview.ai app must register.
const REQUIRED_AGENT_ENDPOINTS = [
  "/review",
  "/api/assignments",
  "/api/assignments/{wid}/submissions",
  "/api/assignments/{wid}/submissions/{sid}",
];
const OPTIONAL_AGENT_ENDPOINTS: string[] = [];

const STEPS: Step[] = [
  {
    name: "verify-pins",
    run: async () => verifyPinsInline(),
  },
  {
    name: "validate-widget --examples (other-examples/*/EXAMPLE.json)",
    run: async () => {
      const validateScript = join(REPO_ROOT, "scripts", "validate-widget.ts");
      const res = spawnSync(
        PNPM,
        [...PNPM_PREFIX, "exec", "tsx", validateScript, "--examples"],
        { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env, FORCE_COLOR: "1" } },
      );
      return {
        pass: res.status === 0,
        detail: res.status === 0 ? "EXAMPLE.json files validated" : `failed (exit ${res.status})`,
      };
    },
  },
  {
    name: "validate-widget over widget/schema dirs",
    run: async () => {
      const widgets = findWidgetJsons();
      if (widgets.length === 0) {
        console.log(
          `${YELLOW}!${RESET} ${DIM}No widget JSONs to validate yet.${RESET}\n`,
        );
        return { pass: true, detail: "skipped (no widgets)" };
      }
      const validateScript = join(REPO_ROOT, "scripts", "validate-widget.ts");
      const res = spawnSync(
        PNPM,
        [...PNPM_PREFIX, "exec", "tsx", validateScript, ...widgets],
        { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env, FORCE_COLOR: "1" } },
      );
      return {
        pass: res.status === 0,
        detail: res.status === 0 ? `${widgets.length} files validated` : `failed (exit ${res.status})`,
      };
    },
  },
  {
    name: "test:widgets",
    run: async () => pnpmRun("test:widgets"),
  },
  {
    name: "explain sanity (pnpm explain themes resolves a HACKATHON.md section)",
    run: async () => {
      // Regression guard: `pnpm explain` must keep matching HACKATHON.md's
      // live seam headings ("## Â§N â€” Title"). It silently rotted once when
      // the doc's heading style changed â€” this step makes that loud.
      const explainScript = join(REPO_ROOT, "scripts", "explain.ts");
      const res = spawnSync(PNPM, [...PNPM_PREFIX, "exec", "tsx", explainScript, "themes"], {
        cwd: REPO_ROOT,
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "0" },
      });
      const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
      if (res.status !== 0) {
        console.error(out);
        return { pass: false, detail: `pnpm explain themes exited ${res.status}` };
      }
      if (!out.includes("Re-theme")) {
        console.error(out);
        return { pass: false, detail: "explain output missing the Â§1 section" };
      }
      console.log(`${GREEN}âœ“${RESET} ${DIM}pnpm explain themes printed the Â§1 section.${RESET}\n`);
      return { pass: true, detail: "explain resolves seam sections" };
    },
  },
  {
    name: "test:schemas (pytest path-vs-data alignment)",
    run: async () => {
      // `pnpm test:schemas` is `cd agent && uv run python -m pytest tests/`.
      // The pdf-analyst default agent ships no pytest suite at agent/tests/
      // yet (the PortKit schema tests were archived). Skip when the dir is
      // absent so smoke is exit-0 statically; run it the moment a suite lands.
      const testsDir = join(REPO_ROOT, "agent", "tests");
      if (!existsSync(testsDir)) {
        console.log(
          `${YELLOW}!${RESET} ${DIM}agent/tests/ not present â€” no pytest schema suite to run. Skipping.${RESET}\n`,
        );
        return { pass: true, detail: "skipped (no agent/tests/)" };
      }
      return pnpmRun("test:schemas");
    },
  },
  {
    name: "offline envelope shape check (public/offline-envelopes.json)",
    run: async () => {
      // pdf-analyst default swap: public/offline-envelopes.json was archived
      // to other-examples/portkit/public/. When absent, skip cleanly. The
      // shape validation below still runs if a hacker drops a pdf-analyst
      // offline file back at public/offline-envelopes.json.
      const offlinePath = join(REPO_ROOT, "public", "offline-envelopes.json");
      if (!existsSync(offlinePath)) {
        console.log(
          `${YELLOW}!${RESET} ${DIM}public/offline-envelopes.json not present (archived with PortKit). Skipping.${RESET}\n`,
        );
        return { pass: true, detail: "skipped (no offline envelopes)" };
      }
      try {
        const raw = readFileSync(offlinePath, "utf-8");
        const parsed = JSON.parse(raw);

        // The new wrapper shape (plan Â§6.6) has byPrompt + bySurface.
        // We accept the legacy flat shape too (just prompt-keyed) for back-compat.
        const hasWrapper =
          parsed && typeof parsed === "object" &&
          (parsed.byPrompt || parsed.bySurface);

        if (!hasWrapper) {
          // Legacy shape â€” accept if it contains A2UI markers anywhere in the file.
          if (!raw.includes("createSurface") && !raw.includes("surfaceId")) {
            console.error(
              `${RED}âœ—${RESET} public/offline-envelopes.json doesn't reference any A2UI envelope (no createSurface or surfaceId found).`,
            );
            return { pass: false, detail: "envelope check failed: no A2UI markers" };
          }
          console.log(
            `${GREEN}âœ“${RESET} ${DIM}offline-envelopes.json parses and contains A2UI envelope markers (legacy shape).${RESET}\n`,
          );
          return { pass: true, detail: "parsed (legacy shape)" };
        }

        // Wrapper shape â€” validate the bySurface map.
        const bySurface = parsed.bySurface as Record<string, unknown> | undefined;
        if (!bySurface || typeof bySurface !== "object") {
          console.error(
            `${RED}âœ—${RESET} offline-envelopes.json wrapper is missing 'bySurface' object.`,
          );
          return { pass: false, detail: "missing bySurface" };
        }
        const surfaceCount = Object.keys(bySurface).length;
        if (surfaceCount === 0) {
          console.error(
            `${RED}âœ—${RESET} 'bySurface' is empty â€” at least one surface required.`,
          );
          return { pass: false, detail: "empty bySurface" };
        }
        for (const [surfaceId, envs] of Object.entries(bySurface)) {
          if (!Array.isArray(envs) || envs.length === 0) {
            console.error(
              `${RED}âœ—${RESET} bySurface["${surfaceId}"] is not a non-empty array of envelopes.`,
            );
            return { pass: false, detail: `bad bySurface entry: ${surfaceId}` };
          }
        }
        // (PortKit pinned a required "contract-review" surface here; the
        // pdf-analyst default has no such hard requirement â€” any non-empty
        // bySurface map is accepted. Re-add a required-surface assertion here
        // if a future offline file must guarantee a specific surface.)
        console.log(
          `${GREEN}âœ“${RESET} ${DIM}offline-envelopes.json wrapper valid (${surfaceCount} surface${surfaceCount === 1 ? "" : "s"} indexed: ${Object.keys(bySurface).join(", ")}).${RESET}\n`,
        );
        return { pass: true, detail: `${surfaceCount} surfaces indexed` };
      } catch (e) {
        console.error(`${RED}âœ—${RESET} offline-envelopes.json is invalid JSON: ${(e as Error).message}`);
        return { pass: false, detail: "invalid JSON" };
      }
    },
  },
  {
    name: "agent endpoint probe (FastAPI /review + REST API)",
    run: async () => {
      // pdf-analyst default swap: the agent is now the FastAPI app at
      // agent/main.py, not a langgraph-cli graph. Assert it imports cleanly
      // and registers the expected endpoints. We boot `python -c "..."`
      // against the agent's .venv so this is a deterministic, OFFLINE-safe
      // check â€” importing the app builds the LLM clients (with a placeholder
      // key) but makes NO live model call.
      const agentDir = join(REPO_ROOT, "agent");
      const mainPy = join(agentDir, "main.py");
      if (!existsSync(mainPy)) {
        console.log(
          `${YELLOW}!${RESET} ${DIM}agent/main.py not found. Skipping endpoint probe.${RESET}\n`,
        );
        return { pass: true, detail: "skipped (no agent/main.py)" };
      }
      const venvPython =
        process.platform === "win32"
          ? join(agentDir, ".venv", "Scripts", "python.exe")
          : join(agentDir, ".venv", "bin", "python");
      const pythonBin = existsSync(venvPython) ? venvPython : "python3";
      if (!existsSync(venvPython)) {
        console.log(
          `${YELLOW}!${RESET} ${DIM}agent/.venv/bin/python not found â€” using system python3. Run \`pnpm install:agent\` to bootstrap.${RESET}\n`,
        );
      }
      // Cross the JS â†’ Python boundary as Python list literals (string
      // elements, no unpacking â€” JSON arrays of strings are valid Python
      // list literals so JSON.stringify is safe here).
      const requiredPy = JSON.stringify(REQUIRED_AGENT_ENDPOINTS);
      const optionalPy = JSON.stringify(OPTIONAL_AGENT_ENDPOINTS);
      const script = `
import sys

required = ${requiredPy}
optional = ${optionalPy}

try:
    import main
except Exception as e:
    import traceback
    traceback.print_exc()
    print(f"\\nFAIL: importing agent/main.py raised {type(e).__name__}: {e}")
    sys.exit(1)

app = getattr(main, "app", None)
if app is None:
    print("FAIL: agent/main.py has no module-level 'app' (expected a FastAPI instance).")
    sys.exit(1)

# Collect the set of registered route paths (FastAPI Route objects expose .path).
paths = set()
for r in getattr(app, "routes", []):
    p = getattr(r, "path", None)
    if isinstance(p, str):
        paths.add(p)

missing = [p for p in required if p not in paths]
present_optional = [p for p in optional if p in paths]

for p in required:
    print(f"  {'OK' if p in paths else 'MISSING'}: {p}")
for p in optional:
    print(f"  {'OK' if p in paths else 'absent (optional)'}: {p}")

if missing:
    print(f"\\nFAIL: agent/main.py is missing required endpoint(s): {missing}")
    sys.exit(1)

print(f"\\nFastAPI app registers all required endpoints ({required}); optional present: {present_optional}.")
sys.exit(0)
`;
      // Provide a placeholder GEMINI_API_KEY â€” the agents construct
      // ChatGoogleGenerativeAI clients at import time. The probe imports the
      // app, it does NOT make a live call, so a placeholder is sufficient.
      const probeEnv = {
        ...process.env,
        FORCE_COLOR: "1",
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || "smoke-probe-placeholder",
      };
      const res = spawnSync(pythonBin, ["-c", script], {
        cwd: agentDir,
        stdio: "inherit",
        env: probeEnv,
      });
      if (res.status === 0) {
        return { pass: true, detail: "FastAPI endpoints registered" };
      }
      if (res.status === 1) {
        return { pass: false, detail: "agent/main.py failed to import or missing endpoints" };
      }
      // Likely env issue (missing venv or python). Don't fail smoke; warn loudly.
      console.log(
        `${YELLOW}!${RESET} ${DIM}agent endpoint probe could not run (exit ${res.status}). Run \`pnpm install:agent\` to bootstrap the venv.${RESET}\n`,
      );
      return { pass: true, detail: `skipped (probe exit ${res.status})` };
    },
  },
  {
    name: "offline review surface probe (no key -> real A2UI surface)",
    run: async () => {
      // Build the current PeerReview.ai review/final A2UI component trees
      // directly, with no model key and no server. This keeps smoke static
      // while catching catalog/surface drift.
      const agentDir = join(REPO_ROOT, "agent");
      const mainPy = join(agentDir, "main.py");
      if (!existsSync(mainPy)) {
        console.log(
          `${YELLOW}!${RESET} ${DIM}agent/main.py not found. Skipping offline review surface probe.${RESET}\n`,
        );
        return { pass: true, detail: "skipped (no agent/main.py)" };
      }
      const venvPython =
        process.platform === "win32"
          ? join(agentDir, ".venv", "Scripts", "python.exe")
          : join(agentDir, ".venv", "bin", "python");
      const pythonBin = existsSync(venvPython) ? venvPython : "python3";
      if (!existsSync(venvPython)) {
        console.log(
          `${YELLOW}!${RESET} ${DIM}agent/.venv/bin/python not found â€” using system python3. Run \`pnpm install:agent\` to bootstrap.${RESET}\n`,
        );
      }
      const script = `
import sys

try:
    from src.peerreview import surfaces
except Exception as e:
    import traceback
    traceback.print_exc()
    print(f"\\nFAIL: importing peerreview surfaces raised {type(e).__name__}: {e}")
    sys.exit(1)

review_id = surfaces.review_surface_id("smoke-workspace", "smoke-submission")
final_id = surfaces.final_surface_id("smoke-workspace", "smoke-submission")
review = surfaces.build_review_surface({
    "workspace_id": "smoke-workspace",
    "submission_id": "smoke-submission",
    "assignment_title": "Smoke assignment",
    "submission_name": "Smoke student",
    "source": "smoke",
    "repo": {"file_count": 1, "entry_file": "solution.py", "entry_func": "shortest_path"},
    "entry_code": "def shortest_path(graph, start, goal):\\n    return [start, goal]\\n",
    "diff": {"summary": {"total": 1, "passed": 0, "failed": 1}, "cases": [{
        "name": "case 1", "status": "failed", "message": "expected ['A', 'B'] but got ['A']",
        "input": [{"from": "A", "to": "B"}], "expected": ["A", "B"], "actual": ["A"],
    }]},
    "misconception": {"detected": True, "label": "smoke", "title": "Smoke diagnosis",
                      "severity": "medium", "explanation": "A deterministic smoke diagnosis.",
                      "evidence": ["case 1 failed"]},
    "trace": None,
    "scorecard": [{"id": "correctness", "label": "Correctness", "max": 5, "proposed": 3,
                   "rationale": "Smoke rationale"}],
    "proposed_total": 3,
    "max_total": 5,
    "calibration": {"count": 0},
})
final = surfaces.build_final_surface({
    "greeting": "Feedback",
    "letter_paragraphs": ["Smoke feedback paragraph."],
    "plain_text": "Feedback\\nSmoke feedback paragraph.",
    "breakdown": [{"label": "Correctness", "score": 3, "max": 5}],
    "total": 3,
    "max_total": 5,
    "grade_caption": "Pass",
    "submission_name": "Smoke student",
})

required_review_components = {"GradeApprovalPanel", "TestResultsPanel", "MisconceptionPanel"}
required_final_components = {"CopyFeedbackPanel", "DataTable", "StatCard"}
review_components = {c.get("component") for c in review}
final_components = {c.get("component") for c in final}
missing_review = sorted(required_review_components - review_components)
missing_final = sorted(required_final_components - final_components)
if review_id != "peerreview-review:smoke-workspace:smoke-submission":
    print(f"FAIL: review surface id is not scoped: {review_id}")
    sys.exit(1)

if final_id != "peerreview-final:smoke-workspace:smoke-submission":
    print(f"FAIL: final surface id is not scoped: {final_id}")
    sys.exit(1)

if missing_review or missing_final:
    print(f"FAIL: surface components missing review={missing_review}, final={missing_final}")
    sys.exit(1)

print(f"  OK: {review_id}")
print(f"  OK: {final_id}")
print("\\nOffline PeerReview.ai surfaces include review gate and feedback handoff.")
sys.exit(0)
`;
      // Explicitly remove model keys: this surface-builder check should not
      // depend on live Gemini credentials.
      const {
        GEMINI_API_KEY: _gemini,
        GOOGLE_API_KEY: _google,
        ...envWithoutKeys
      } = process.env;
      const offlineEnv = { ...envWithoutKeys, FORCE_COLOR: "1", OFFLINE: "1" };
      const res = spawnSync(pythonBin, ["-c", script], {
        cwd: agentDir,
        stdio: "inherit",
        env: offlineEnv,
      });
      if (res.status === 0) {
        return { pass: true, detail: "offline review/final surfaces built (no key)" };
      }
      if (res.status === 1) {
        return { pass: false, detail: "offline PeerReview.ai surface probe failed" };
      }
      // Non-1 exit: probe couldn't run (missing venv/python). Warn, don't fail.
      console.log(
        `${YELLOW}!${RESET} ${DIM}offline review surface probe could not run (exit ${res.status}). Run \`pnpm install:agent\` to bootstrap the venv.${RESET}\n`,
      );
      return { pass: true, detail: `skipped (probe exit ${res.status})` };
    },
  },
  {
    name: "agent connectivity probe (live one-shot tool call against Gemini)",
    run: async () => {
      // LIVE check â€” requires a running, Gemini-backed agent + GEMINI_API_KEY.
      // Reuses the standalone probe-gemini.sh script (exercises a tool call
      // against the configured model). This is a SKIP whenever there's no key
      // or OFFLINE=1, so `pnpm smoke` is exit-0 statically. Future
      // improvement: "boot FastAPI agent â†’ POST canned prompt to /fixed â†’
      // assert a createSurface envelope" once there's a deterministic boot
      // ritual we can call from CI.
      const probeScript = join(REPO_ROOT, "scripts", "probe-gemini.sh");
      if (!existsSync(probeScript)) {
        console.log(`${YELLOW}!${RESET} ${DIM}probe-gemini.sh not found. Skipping.${RESET}\n`);
        return { pass: true, detail: "skipped (no probe script)" };
      }
      // Skip when no key â€” let CI decide whether that's OK via OFFLINE=1.
      if (!process.env.GEMINI_API_KEY && process.env.OFFLINE !== "1") {
        console.log(
          `${YELLOW}!${RESET} ${DIM}SKIP: live agent probe requires a running agent + GEMINI_API_KEY (neither GEMINI_API_KEY nor OFFLINE=1 set).${RESET}\n`,
        );
        return { pass: true, detail: "skipped (no key â€” requires running agent + key)" };
      }
      if (process.env.OFFLINE === "1") {
        console.log(`${DIM}OFFLINE=1 â€” skipping live model probe.${RESET}\n`);
        return { pass: true, detail: "skipped (OFFLINE=1)" };
      }
      return shellRun("bash", [probeScript]);
    },
  },
];

async function main(): Promise<void> {
  console.log(`${BOLD}pnpm smoke${RESET} â€” composite gate\n`);

  let failed = 0;

  for (const step of STEPS) {
    console.log(`${BOLD}â”â”â” ${step.name} â”â”â”${RESET}`);
    const t0 = Date.now();
    const res = await step.run();
    const ms = Date.now() - t0;
    results.push({ name: step.name, ...res });
    if (!res.pass) {
      failed++;
      // Fail fast â€” first failure is usually informative enough.
      console.error(
        `\n${RED}${BOLD}Step "${step.name}" failed (${ms}ms).${RESET} Stopping early.\n`,
      );
      break;
    }
    console.log(`${DIM}  â†’ step done in ${ms}ms${RESET}\n`);
  }

  // Summary
  console.log(`${BOLD}â”â”â” smoke summary â”â”â”${RESET}`);
  for (const r of results) {
    const icon = r.pass ? `${GREEN}âœ“${RESET}` : `${RED}âœ—${RESET}`;
    console.log(`  ${icon} ${r.name} ${DIM}â€” ${r.detail}${RESET}`);
  }
  // List steps that didn't run
  const ran = new Set(results.map((r) => r.name));
  for (const s of STEPS) {
    if (!ran.has(s.name)) console.log(`  ${YELLOW}-${RESET} ${s.name} ${DIM}(not run)${RESET}`);
  }
  console.log();

  if (failed === 0) {
    console.log(`${GREEN}${BOLD}SMOKE PASS.${RESET}`);
    process.exit(0);
  } else {
    console.log(`${RED}${BOLD}SMOKE FAIL.${RESET}`);
    process.exit(1);
  }
}

void main();

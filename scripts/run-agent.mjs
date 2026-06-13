// Launch the PeerReview.ai FastAPI agent using the agent's own virtualenv —
// no `uv` on PATH required at runtime. Cross-platform (Windows/macOS/Linux).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const agentDir = join(here, "..", "agent");
const py =
  process.platform === "win32"
    ? join(agentDir, ".venv", "Scripts", "python.exe")
    : join(agentDir, ".venv", "bin", "python");

if (!existsSync(py)) {
  console.error(
    "\n[run-agent] Agent virtualenv not found at agent/.venv\n" +
      "Create it once with:\n" +
      "    cd agent && uv sync\n" +
      "(see README → Setup if uv has trouble picking a Python version)\n",
  );
  process.exit(1);
}

const child = spawn(py, ["-m", "uvicorn", "main:app", "--port", "8123", "--reload"], {
  cwd: agentDir,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));

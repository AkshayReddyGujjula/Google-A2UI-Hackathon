// Best-effort agent venv setup. Skips if the venv already exists; otherwise
// tries `uv sync`. Never fails the install (the venv can be created manually).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const agentDir = join(here, "..", "agent");
const venvPy =
  process.platform === "win32"
    ? join(agentDir, ".venv", "Scripts", "python.exe")
    : join(agentDir, ".venv", "bin", "python");

if (existsSync(venvPy)) {
  console.log("[setup-agent] agent/.venv already present — skipping.");
  process.exit(0);
}

const r = spawnSync("uv", ["sync"], { cwd: agentDir, stdio: "inherit", shell: true });
if (r.status !== 0) {
  console.warn(
    "\n[setup-agent] Could not create the venv automatically.\n" +
      "Create it manually:  cd agent && uv sync\n" +
      "(If uv errors on the Python version, pin it: uv sync --python 3.12)\n",
  );
}
process.exit(0);

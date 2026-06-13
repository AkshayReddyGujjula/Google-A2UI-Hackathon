"""Load a student submission from one of three sources:

  - seeded   : a bundled fixture directory (reliable demo path)
  - pasted   : files provided inline (the TA pasted/uploaded code)
  - github   : a public GitHub repository URL (tarball fetch, no auth)

Then locate the entry-point file that defines the assignment's function.
"""
from __future__ import annotations

import io
import re
import tarfile
from typing import Any

from . import store

MAX_FILES = 60
MAX_FILE_BYTES = 200_000


def ingest_seeded(dir_name: str) -> dict[str, Any]:
    fx = store.load_submission_fixture(dir_name)
    return {"ok": True, "source": f"seeded:{dir_name}", "files": fx["files"]}


def ingest_pasted(files: dict[str, str]) -> dict[str, Any]:
    clean = {k: v for k, v in files.items() if k.endswith(".py")}
    if not clean:
        return {"ok": False, "error": "no .py files provided", "files": {}}
    return {"ok": True, "source": "pasted", "files": clean}


def ingest_github(url: str) -> dict[str, Any]:
    """Fetch a public repo's default branch as a tarball and extract .py files."""
    m = re.search(r"github\.com[/:]([^/]+)/([^/#?]+?)(?:\.git)?/?$", url.strip())
    if not m:
        return {"ok": False, "error": f"could not parse a GitHub owner/repo from {url!r}", "files": {}}
    owner, repo = m.group(1), m.group(2)
    api = f"https://api.github.com/repos/{owner}/{repo}/tarball"
    try:
        import requests

        resp = requests.get(api, timeout=30, headers={"Accept": "application/vnd.github+json"})
        resp.raise_for_status()
        files: dict[str, str] = {}
        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz") as tar:
            for member in tar.getmembers():
                if not member.isfile() or not member.name.endswith(".py"):
                    continue
                if member.size > MAX_FILE_BYTES or len(files) >= MAX_FILES:
                    continue
                # strip the leading "<owner>-<repo>-<sha>/" wrapper dir
                rel = member.name.split("/", 1)[1] if "/" in member.name else member.name
                f = tar.extractfile(member)
                if f is None:
                    continue
                try:
                    files[rel] = f.read().decode("utf-8", errors="replace")
                except Exception:  # noqa: BLE001
                    continue
        if not files:
            return {"ok": False, "error": "repo fetched but contained no .py files", "files": {}}
        return {"ok": True, "source": f"github:{owner}/{repo}", "files": files}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"GitHub fetch failed: {exc}", "files": {}}


def locate_entry(files: dict[str, str], function_name: str) -> dict[str, Any] | None:
    """Find the .py file that defines `function_name`. Returns the dotted module
    path used to import it (relative path with '/'→'.' and '.py' stripped)."""
    pattern = re.compile(rf"^\s*def\s+{re.escape(function_name)}\s*\(", re.MULTILINE)
    # Prefer shallower files, then 'solution'/'main'-named files.
    candidates = sorted(files, key=lambda p: (p.count("/"), 0 if "solution" in p else 1, p))
    for rel in candidates:
        if pattern.search(files[rel]):
            module = rel[:-3].replace("/", ".") if rel.endswith(".py") else rel
            return {"entry_file": rel, "entry_module": module, "entry_func": function_name}
    return None

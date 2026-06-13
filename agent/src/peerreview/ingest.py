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
from urllib.parse import urlparse

from . import store

MAX_FILES = 60
MAX_FILE_BYTES = 200_000


def ingest_seeded(dir_name: str) -> dict[str, Any]:
    fx = store.load_submission_fixture(dir_name)
    return {"ok": True, "source": f"seeded:{dir_name}", "files": fx["files"]}


def ingest_pasted(files: dict[str, str]) -> dict[str, Any]:
    clean: dict[str, str] = {}
    for path, source in files.items():
        if len(clean) >= MAX_FILES:
            break
        safe_path = path.replace("\\", "/").lstrip("/")
        if not safe_path.endswith(".py"):
            continue
        if len(source.encode("utf-8", errors="ignore")) > MAX_FILE_BYTES:
            continue
        clean[safe_path] = source
    if not clean:
        return {
            "ok": False,
            "error": "No Python files were provided. Upload a folder containing a .py file that defines the required function.",
            "files": {},
        }
    return {"ok": True, "source": "pasted", "files": clean}


def _parse_github_repo(url: str) -> tuple[str, str] | None:
    """Accept common public GitHub repo URLs and return (owner, repo)."""
    raw = url.strip()
    if not raw:
        return None
    ssh_match = re.match(r"git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$", raw)
    if ssh_match:
        return ssh_match.group(1), ssh_match.group(2)

    parsed = urlparse(raw if re.match(r"https?://", raw, re.I) else f"https://{raw}")
    if parsed.netloc.lower() not in {"github.com", "www.github.com"}:
        return None
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 2:
        return None
    owner, repo = parts[0], parts[1]
    if repo.endswith(".git"):
        repo = repo[:-4]
    if not owner or not repo:
        return None
    return owner, repo


def ingest_github(url: str) -> dict[str, Any]:
    """Fetch a public repo's default branch as a tarball and extract .py files."""
    parsed = _parse_github_repo(url)
    if not parsed:
        return {
            "ok": False,
            "error": f"Could not parse a GitHub owner/repo from {url!r}. Use a public repo URL like https://github.com/user/repo.",
            "files": {},
        }
    owner, repo = parsed
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
            return {
                "ok": False,
                "error": f"Fetched github:{owner}/{repo}, but it did not contain any Python files.",
                "files": {},
            }
        return {"ok": True, "source": f"github:{owner}/{repo}", "files": files}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"GitHub fetch failed for {owner}/{repo}: {exc}", "files": {}}


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

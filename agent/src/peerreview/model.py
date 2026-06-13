"""Gemini model resolution + a shared chat-model builder.

`MODEL` in .env is used if the key actually exposes it; otherwise we fall back to
a sensible current flash model (validated against the live ListModels response),
so a swapped key never silently breaks every LLM call. Resolution is cached.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

_PREFERRED = [
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-flash-latest",
    "gemini-2.0-flash",
]


@lru_cache(maxsize=1)
def _available_models() -> tuple[str, ...]:
    """Models the current key can call with generateContent. Empty tuple if the
    lookup fails (we then trust the configured MODEL and let the call surface any error)."""
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        return ()
    try:
        import requests

        resp = requests.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": key},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        out = []
        for m in data.get("models", []):
            if "generateContent" in m.get("supportedGenerationMethods", []):
                out.append(m["name"].split("/")[-1])
        return tuple(out)
    except Exception:  # noqa: BLE001
        return ()


@lru_cache(maxsize=1)
def resolve_model() -> str:
    """The model id to use. Prefer env MODEL when valid, else a preferred flash."""
    configured = os.getenv("MODEL", "").strip()
    available = _available_models()
    if not available:
        return configured or "gemini-3.5-flash"
    if configured and configured in available:
        return configured
    for cand in _PREFERRED:
        if cand in available:
            return cand
    flash = [m for m in available if "flash" in m and "tts" not in m and "image" not in m]
    return flash[0] if flash else available[0]


def model_status() -> dict[str, Any]:
    """For a startup/health log: which model, and whether the key resolved any."""
    available = _available_models()
    return {
        "model": resolve_model(),
        "key_present": bool(os.getenv("GEMINI_API_KEY")),
        "models_visible": len(available),
    }


def text_of(resp: Any) -> str:
    """Flatten a chat response's content to text. Gemini (via langchain-google-genai)
    may return a list of content parts (dicts with a 'text' field) rather than a str."""
    c = getattr(resp, "content", resp)
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        parts = []
        for p in c:
            if isinstance(p, dict):
                parts.append(p.get("text", ""))
            else:
                parts.append(str(p))
        return "".join(parts)
    return str(c)


def build_chat_model(temperature: float = 0.0) -> Any:
    """A ChatGoogleGenerativeAI on the resolved model. Constructed lazily by callers
    (it validates the key in its constructor)."""
    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(
        model=resolve_model(),
        google_api_key=os.getenv("GEMINI_API_KEY"),
        temperature=temperature,
    )

"""mtime-cached prompt file loader with SHA-1 version tracking."""
from __future__ import annotations

import hashlib
from pathlib import Path

from src.i18n.languages import SUPPORTED_LANGUAGES

_CACHE: dict[str, tuple[float, str, str]] = {}  # path_str -> (mtime, content, sha1[:8])

_DEFAULT_DIR = Path(__file__).resolve().parent.parent.parent / "prompts"


def _resolve_path(base: Path, name: str, lang: str) -> Path:
    """Resolve the prompt path, falling back to Korean if language-specific file missing."""
    suffix = SUPPORTED_LANGUAGES.get(lang, SUPPORTED_LANGUAGES["ko"]).prompt_suffix

    if suffix:
        # name format is e.g. "daily_brief.system" -> "daily_brief.system.en.txt"
        candidate = base / f"{name}{suffix}.txt"
        if candidate.exists():
            return candidate
    # Fallback to Korean (no suffix)
    return base / f"{name}.txt"


def load_prompt(
    name: str, base_dir: "Path | None" = None, lang: str = "ko"
) -> tuple[str, str]:
    """Load a prompt file by name (without .txt extension).

    Returns (content, sha1[:8]).
    Uses mtime-based cache keyed by resolved path. Because language-specific
    files have distinct paths (e.g., "daily_brief.system.en.txt" vs
    "daily_brief.system.txt"), different languages do not collide.
    """
    base = base_dir if base_dir is not None else _DEFAULT_DIR
    path = _resolve_path(base, name, lang)
    path_str = str(path)

    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        return f"[prompt not found: {name}]", "00000000"

    cached = _CACHE.get(path_str)
    if cached is not None and cached[0] == mtime:
        return cached[1], cached[2]

    content = path.read_text(encoding="utf-8")
    sha = hashlib.sha1(content.encode()).hexdigest()[:8]
    _CACHE[path_str] = (mtime, content, sha)
    return content, sha

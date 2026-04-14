"""mtime-cached prompt file loader with SHA-1 version tracking."""
from __future__ import annotations

import hashlib
from pathlib import Path

_CACHE: dict[str, tuple[float, str, str]] = {}  # path -> (mtime, content, sha1[:8])

_DEFAULT_DIR = Path(__file__).resolve().parent.parent.parent / "prompts"


def load_prompt(name: str, base_dir: "Path | None" = None) -> tuple[str, str]:
    """Load a prompt file by name (without .txt extension).

    Returns (content, sha1[:8]).
    Uses mtime-based cache: unchanged files are not re-read.
    """
    base = base_dir if base_dir is not None else _DEFAULT_DIR
    path = base / f"{name}.txt"
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

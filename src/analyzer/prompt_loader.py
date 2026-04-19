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
    name: str, base_dir: "Path | None" = None, lang: str = "ko", mode: str = ""
) -> tuple[str, str]:
    """Load a prompt file by name (without .txt extension).

    mode가 지정되면 "name.mode" 형태로 먼저 시도하고, 없으면 name으로 폴백한다.
    예: name="daily_brief.system", mode="full" -> "daily_brief.full.system" 시도 후 폴백.

    Returns (content, sha1[:8]).
    Uses mtime-based cache keyed by resolved path. Because language-specific
    files have distinct paths (e.g., "daily_brief.system.en.txt" vs
    "daily_brief.system.txt"), different languages do not collide.
    """
    base = base_dir if base_dir is not None else _DEFAULT_DIR

    # mode가 있으면 "a.b" -> "a.{mode}.b" 형태로 먼저 시도 후 원본으로 폴백
    # 예: name="daily_brief.system", mode="full" -> "daily_brief.full.system"
    if mode:
        parts = name.rsplit(".", 1)
        if len(parts) == 2:
            mode_name = f"{parts[0]}.{mode}.{parts[1]}"
        else:
            mode_name = f"{name}.{mode}"
        mode_path = _resolve_path(base, mode_name, lang)
        if mode_path.exists():
            path = mode_path
        else:
            path = _resolve_path(base, name, lang)
    else:
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

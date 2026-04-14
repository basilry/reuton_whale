from pathlib import Path
from unittest import mock

import pytest

import src.analyzer.prompt_loader as pl


def _clear():
    pl._CACHE.clear()


def test_load_prompt_returns_content_and_sha1(tmp_path):
    f = tmp_path / "hello.txt"
    f.write_text("world", encoding="utf-8")
    _clear()

    content, sha = pl.load_prompt("hello", base_dir=tmp_path)

    assert content == "world"
    assert len(sha) == 8


def test_load_prompt_missing_file(tmp_path):
    _clear()
    content, sha = pl.load_prompt("nonexistent", base_dir=tmp_path)

    assert "not found" in content
    assert sha == "00000000"


def _make_read_text_counter():
    """Return (patched_method, call_count_list) where call_count_list[0] increments on each read."""
    _original = Path.read_text
    calls = [0]

    def _counting(self, encoding=None, errors=None):
        calls[0] += 1
        return _original(self, encoding=encoding, errors=errors)

    return _counting, calls


def test_prompt_loader_caches_file_reads(tmp_path):
    f = tmp_path / "greet.txt"
    f.write_text("hello world", encoding="utf-8")
    _clear()

    # Path.read_text() in Python 3.12+ uses C-level io, bypassing builtins.open.
    # Patch Path.read_text with a counting wrapper to track actual disk reads.
    counter, calls = _make_read_text_counter()
    with mock.patch.object(Path, "read_text", counter):
        c1, s1 = pl.load_prompt("greet", base_dir=tmp_path)
        c2, s2 = pl.load_prompt("greet", base_dir=tmp_path)

    assert c1 == c2 == "hello world"
    assert s1 == s2
    assert calls[0] == 1, f"Expected read_text() called once, got {calls[0]}"


def test_prompt_loader_invalidates_on_mtime_change(tmp_path):
    f = tmp_path / "signal.txt"
    f.write_text("version one", encoding="utf-8")
    _clear()

    counter, calls = _make_read_text_counter()
    with mock.patch.object(Path, "read_text", counter):
        pl.load_prompt("signal", base_dir=tmp_path)

        # Force cache invalidation by backdating the stored mtime
        path_str = str(tmp_path / "signal.txt")
        cached = pl._CACHE[path_str]
        pl._CACHE[path_str] = (cached[0] - 1.0, cached[1], cached[2])

        pl.load_prompt("signal", base_dir=tmp_path)

    assert calls[0] == 2, f"Expected read_text() called twice after mtime change, got {calls[0]}"


def test_sha1_not_recomputed_on_cache_hit(tmp_path):
    f = tmp_path / "stable.txt"
    f.write_text("constant content", encoding="utf-8")
    _clear()

    _, s1 = pl.load_prompt("stable", base_dir=tmp_path)

    with mock.patch("hashlib.sha1") as mock_sha:
        _, s2 = pl.load_prompt("stable", base_dir=tmp_path)
        mock_sha.assert_not_called()

    assert s1 == s2

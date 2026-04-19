from __future__ import annotations

import os
from collections.abc import Mapping

import pytest


def require_contract_base_url(env_name: str) -> str:
    value = os.getenv(env_name, "").strip()
    if not value:
        pytest.skip(f"{env_name} not set; live contract tests are opt-in")
    return value.rstrip("/")


def contract_sample_address(env_name: str, default: str) -> str:
    value = os.getenv(env_name, "").strip()
    return value or default


def assert_required_keys(payload: Mapping[str, object], *required_keys: str) -> None:
    missing = [key for key in required_keys if key not in payload]
    assert not missing, f"missing required keys: {', '.join(missing)}"


def assert_any_key(payload: Mapping[str, object], *candidate_keys: str) -> None:
    assert any(key in payload for key in candidate_keys), (
        f"expected at least one of {candidate_keys}, got keys={sorted(payload.keys())}"
    )

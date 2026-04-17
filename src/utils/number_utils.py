"""Shared numeric coercion helpers.

The project had two duplicated ``_safe_float`` implementations (one in
``src/main.py`` stripping commas at WARNING level, another in
``src/signals/baseline.py`` at DEBUG level). This module unifies them behind
a single function with options, so callers can opt in to the behavior they
need without maintaining parallel copies.
"""
from __future__ import annotations

import logging
from typing import Any

from src.utils.logger import get_logger

_DEFAULT_LOGGER = get_logger("utils.number_utils")


def safe_float(
    value: Any,
    *,
    default: float = 0.0,
    strip_commas: bool = False,
    field_name: str | None = None,
    log_level: int = logging.DEBUG,
    logger: logging.Logger | None = None,
) -> float:
    """Coerce ``value`` to ``float`` with a safe fallback.

    Args:
        value: Any object; typically a str, int, float, or None.
        default: Returned when coercion fails or ``value`` is falsy-None.
        strip_commas: If True, remove ``,`` from the string form before parsing
            (useful for values like ``"1,012,450"``).
        field_name: Logged alongside the raw value when coercion fails, to aid
            debugging cross-module calls.
        log_level: ``logging.DEBUG`` (default) or ``logging.WARNING``. Use
            WARNING when the miss should surface in standard ops logs.
        logger: Override logger; defaults to the module logger.

    Returns:
        The parsed float, or ``default`` when the value is unparseable.
    """
    active_logger = logger or _DEFAULT_LOGGER
    if value is None:
        return default
    try:
        if strip_commas:
            return float(str(value).replace(",", ""))
        return float(value)
    except (TypeError, ValueError):
        active_logger.log(
            log_level,
            "safe_float failed field=%s value=%r; defaulting to %s",
            field_name,
            value,
            default,
        )
        return default

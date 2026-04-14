"""Shared HTTP GET helper with exponential backoff for rate-limit responses."""
from __future__ import annotations

import random
import time
from typing import Callable

import requests


def get_with_backoff(
    do_get: Callable[[], requests.Response],
    *,
    is_rate_limited: Callable[[dict], bool] | None = None,
    error_cls: type[Exception] = RuntimeError,
    logger=None,
    max_attempts: int = 5,
) -> requests.Response:
    """Execute do_get() with exponential backoff on 429, 5xx, or JSON rate-limit.

    Retry logic:
      - HTTP 429                               → backoff
      - HTTP 5xx                               → backoff
      - 2xx + is_rate_limited(data) == True    → backoff
      - HTTP 4xx (not 429)                     → immediate raise error_cls
      - Network error (RequestException)       → immediate raise error_cls
      - All attempts exhausted                 → raise error_cls
    """
    for attempt in range(max_attempts):
        try:
            resp = do_get()
        except requests.RequestException as exc:
            raise error_cls(f"HTTP error: {exc}") from exc

        status = resp.status_code

        if status == 429 or 500 <= status < 600:
            _sleep_backoff(attempt, logger, f"HTTP {status}")
            continue

        if 400 <= status < 500:
            raise error_cls(f"HTTP {status}")

        # 2xx — optionally check JSON body for API-level rate limit
        if is_rate_limited is not None:
            try:
                data = resp.json()
            except Exception:
                return resp
            if is_rate_limited(data):
                _sleep_backoff(attempt, logger, "JSON rate-limit")
                continue

        return resp

    raise error_cls("rate-limit: max retries exceeded")


def _sleep_backoff(attempt: int, logger, reason: str) -> None:
    delay = min(2 ** attempt, 60) * random.uniform(0.8, 1.2)
    if logger:
        logger.warning(
            "backoff reason=%s attempt=%d sleeping=%.1fs", reason, attempt, delay
        )
    time.sleep(delay)

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock
from unittest.mock import patch

from src.notify.pipeline_events import publish_pipeline_event
from src.notify.pipeline_events import publish_success_event


def test_publish_pipeline_event_noops_when_sse_disabled(monkeypatch):
    monkeypatch.delenv("WHALESCOPE_REDIS_REST_URL", raising=False)
    monkeypatch.delenv("WHALESCOPE_REDIS_REST_TOKEN", raising=False)
    monkeypatch.setenv("WHALESCOPE_SSE_ENABLED", "false")

    with patch("src.notify.pipeline_events.requests.post") as post:
        published = publish_pipeline_event(
            section="news",
            pipeline="news_rss",
            status="completed",
            emitted_at="2026-04-19T08:00:00+00:00",
            slot_key="20260419T1700",
            summary="feeds_ok=3",
        )

    assert published is False
    post.assert_not_called()


def test_publish_pipeline_event_posts_upstash_pipeline_commands(monkeypatch):
    monkeypatch.setenv("WHALESCOPE_SSE_ENABLED", "true")
    monkeypatch.setenv("WHALESCOPE_REDIS_REST_URL", "https://example.upstash.io")
    monkeypatch.setenv("WHALESCOPE_REDIS_REST_TOKEN", "secret-token")

    response = MagicMock()
    response.raise_for_status.return_value = None

    with patch("src.notify.pipeline_events.requests.post", return_value=response) as post:
        published = publish_pipeline_event(
            section="watchlist",
            pipeline="curated_balance",
            status="completed",
            emitted_at="2026-04-19T08:15:00+00:00",
            slot_key="20260419T1715",
            summary="wallets=12",
        )

    assert published is True
    post.assert_called_once()
    assert post.call_args.args[0] == "https://example.upstash.io/pipeline"
    assert post.call_args.kwargs["headers"]["Authorization"] == "Bearer secret-token"

    commands = post.call_args.kwargs["json"]
    assert commands[0][:2] == ["SET", "whalescope:last_update"]
    assert commands[1][:2] == ["PUBLISH", "whalescope:updates"]

    payload = json.loads(commands[0][2])
    assert payload == {
        "section": "watchlist",
        "pipeline": "curated_balance",
        "status": "completed",
        "emitted_at": "2026-04-19T08:15:00+00:00",
        "summary": "wallets=12",
        "slot_key": "20260419T1715",
    }


def test_publish_success_event_noops_for_non_completed_status(monkeypatch):
    monkeypatch.setenv("WHALESCOPE_SSE_ENABLED", "true")
    monkeypatch.setenv("WHALESCOPE_REDIS_REST_URL", "https://example.upstash.io")
    monkeypatch.setenv("WHALESCOPE_REDIS_REST_TOKEN", "secret-token")

    with patch("src.notify.pipeline_events.requests.post") as post:
        published = publish_success_event(
            section="news",
            pipeline="news_rss",
            result={
                "status": "completed_with_errors",
                "details": "feeds_failed=1",
                "run_id": "news_rss_20260419_080000",
            },
        )

    assert published is False
    post.assert_not_called()


def test_publish_success_event_uses_fallback_summary_when_details_missing(monkeypatch):
    monkeypatch.setenv("WHALESCOPE_SSE_ENABLED", "true")
    monkeypatch.setenv("WHALESCOPE_REDIS_REST_URL", "https://example.upstash.io")
    monkeypatch.setenv("WHALESCOPE_REDIS_REST_TOKEN", "secret-token")

    response = MagicMock()
    response.raise_for_status.return_value = None

    with patch("src.notify.pipeline_events.requests.post", return_value=response) as post:
        published = publish_success_event(
            section="brief",
            pipeline="brief",
            result={
                "status": "completed",
                "finished_at": "2026-04-19T09:00:00+00:00",
                "run_id": "brief_20260419_090000",
            },
        )

    assert published is True
    payload = json.loads(post.call_args.kwargs["json"][0][2])
    assert payload["summary"] == "brief:completed"
    assert payload["run_id"] == "brief_20260419_090000"

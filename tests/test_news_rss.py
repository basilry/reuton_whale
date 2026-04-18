from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from src.ingestion.news_rss import FeedFetchResult, _entry_id, run_news_rss_refresh
from src.storage.schema import ALL_TABS, NEWS_FEED_HEADERS


def _make_client():
    with patch("src.storage.sheets_client.gspread") as mock_gspread, patch(
        "src.storage.sheets_client.Credentials"
    ) as mock_creds:
        mock_creds.from_service_account_info.return_value = MagicMock()
        mock_gc = MagicMock()
        mock_gspread.authorize.return_value = mock_gc
        mock_ss = MagicMock()
        mock_gc.open_by_key.return_value = mock_ss
        mock_ss.worksheets.return_value = [MagicMock(title=t) for t in ALL_TABS]

        from src.storage.sheets_client import SheetsClient

        client = SheetsClient("fake_id", '{"type":"service_account"}')
        return client, mock_ss


def test_entry_id_is_deterministic():
    left = _entry_id("CoinDesk", "https://example.com/a", "Whale move", "2026-04-18T00:00:00+00:00")
    right = _entry_id("CoinDesk", "https://example.com/a", "Whale move", "2026-04-18T00:00:00+00:00")
    assert left == right


def test_append_news_feed_deduplicates_existing_hash():
    client, mock_ss = _make_client()
    mock_ws = MagicMock()
    mock_ss.worksheet.return_value = mock_ws

    existing_id, existing_hash = _entry_id(
        "CoinDesk",
        "https://example.com/a",
        "Whale move",
        "2026-04-18T00:00:00+00:00",
    )
    existing_row = [""] * len(NEWS_FEED_HEADERS)
    existing_row[NEWS_FEED_HEADERS.index("id")] = existing_id
    existing_row[NEWS_FEED_HEADERS.index("hash")] = existing_hash
    mock_ws.get_all_values.return_value = [NEWS_FEED_HEADERS, existing_row]

    inserted = client.append_news_feed(
        [
            {
                "id": existing_id,
                "hash": existing_hash,
                "source": "CoinDesk",
                "title": "Whale move",
                "url": "https://example.com/a",
                "published_at": "2026-04-18T00:00:00+00:00",
            }
        ]
    )

    assert inserted == 0
    mock_ws.append_rows.assert_not_called()


def test_append_news_feed_skips_duplicate_rows_within_same_batch():
    client, mock_ss = _make_client()
    mock_ws = MagicMock()
    mock_ss.worksheet.return_value = mock_ws
    mock_ws.get_all_values.return_value = [NEWS_FEED_HEADERS]

    _id, digest = _entry_id(
        "CoinDesk",
        "https://example.com/a",
        "Whale move",
        "2026-04-18T00:00:00+00:00",
    )
    inserted = client.append_news_feed(
        [
            {
                "id": _id,
                "hash": digest,
                "source": "CoinDesk",
                "title": "Whale move",
                "url": "https://example.com/a",
                "published_at": "2026-04-18T00:00:00+00:00",
            },
            {
                "id": _id,
                "hash": digest,
                "source": "CoinDesk",
                "title": "Whale move",
                "url": "https://example.com/a",
                "published_at": "2026-04-18T00:00:00+00:00",
            },
        ]
    )

    assert inserted == 1
    mock_ws.append_rows.assert_called_once()


def test_run_news_rss_refresh_returns_rich_metadata_and_logs_run():
    client = MagicMock()
    client.append_news_feed.return_value = 2

    feed_results = [
        FeedFetchResult(
            source="CoinDesk",
            url="https://example.com/a",
            language="en",
            status="ok",
            items_fetched=2,
            http_status=200,
        ),
        FeedFetchResult(
            source="Decrypt",
            url="https://example.com/b",
            language="en",
            status="error",
            items_fetched=0,
            http_status=503,
            error="upstream timeout",
        ),
    ]
    rows = [
        {"id": "1", "hash": "h1", "source": "CoinDesk", "title": "One"},
        {"id": "2", "hash": "h2", "source": "CoinDesk", "title": "Two"},
    ]

    with patch(
        "src.ingestion.news_rss.load_listener_config",
        return_value=SimpleNamespace(sheet_id="sheet", google_credentials="{}"),
    ), patch("src.ingestion.news_rss.SheetsClient", return_value=client), patch(
        "src.ingestion.news_rss.NewsRssIngestor.fetch",
        return_value=(rows, feed_results),
    ):
        result = run_news_rss_refresh()

    assert result["status"] == "completed_with_errors"
    assert result["items_fetched"] == 2
    assert result["items_new"] == 2
    assert result["feeds_ok"] == 1
    assert result["feeds_failed"] == 1
    assert json.loads(result["details"])["feeds_failed"] == 1
    client.log_run.assert_called_once()

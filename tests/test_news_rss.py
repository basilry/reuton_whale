from __future__ import annotations

from unittest.mock import MagicMock, patch

from src.ingestion.news_rss import _entry_id
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

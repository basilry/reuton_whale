from __future__ import annotations

from unittest.mock import MagicMock, patch

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

        return SheetsClient("fake_id", '{"type":"service_account"}')


def test_ensure_news_feed_schema_resizes_before_writing_empty_sheet_header():
    client = _make_client()
    ws = MagicMock()
    ws.col_count = len(NEWS_FEED_HEADERS) - 1

    client._ensure_news_feed_schema(ws, [])

    ws.resize.assert_called_once_with(cols=len(NEWS_FEED_HEADERS))
    ws.append_row.assert_called_once_with(list(NEWS_FEED_HEADERS))
    assert [call[0] for call in ws.method_calls] == ["resize", "append_row"]


def test_ensure_news_feed_schema_is_noop_when_header_matches():
    client = _make_client()
    ws = MagicMock()
    ws.col_count = len(NEWS_FEED_HEADERS)

    client._ensure_news_feed_schema(ws, [list(NEWS_FEED_HEADERS)])

    ws.resize.assert_not_called()
    ws.update.assert_not_called()
    ws.append_row.assert_not_called()


def test_ensure_news_feed_schema_resizes_before_extending_prefix_header():
    client = _make_client()
    ws = MagicMock()
    ws.col_count = len(NEWS_FEED_HEADERS) - 1
    header = list(NEWS_FEED_HEADERS[:-1])

    client._ensure_news_feed_schema(ws, [header])

    ws.resize.assert_called_once_with(cols=len(NEWS_FEED_HEADERS))
    ws.update.assert_called_once_with(
        "K1:K1",
        [[NEWS_FEED_HEADERS[-1]]],
        value_input_option="RAW",
    )
    assert [call[0] for call in ws.method_calls] == ["resize", "update"]


def test_ensure_news_feed_schema_aborts_on_longer_than_expected_header():
    client = _make_client()
    ws = MagicMock()
    ws.col_count = len(NEWS_FEED_HEADERS) + 1
    header = [*NEWS_FEED_HEADERS, "custom_tail"]

    with patch("src.storage.sheets_client.logger.warning") as mock_warning:
        client._ensure_news_feed_schema(ws, [header])

    mock_warning.assert_called_once()
    ws.resize.assert_not_called()
    ws.update.assert_not_called()
    ws.append_row.assert_not_called()


def test_ensure_news_feed_schema_aborts_on_non_prefix_header():
    client = _make_client()
    ws = MagicMock()
    ws.col_count = len(NEWS_FEED_HEADERS)
    header = list(NEWS_FEED_HEADERS[:-1])
    header[-1] = "unexpected_column"

    with patch("src.storage.sheets_client.logger.warning") as mock_warning:
        client._ensure_news_feed_schema(ws, [header])

    mock_warning.assert_called_once()
    ws.resize.assert_not_called()
    ws.update.assert_not_called()
    ws.append_row.assert_not_called()

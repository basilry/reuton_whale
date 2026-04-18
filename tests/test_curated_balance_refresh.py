from __future__ import annotations

from unittest.mock import MagicMock, patch

from src.ingestion.curated_balance_refresh import build_balance_rows
from src.storage.schema import ALL_TABS, CURATED_WALLET_BALANCES_HEADERS


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


def test_build_balance_rows_filters_invalid_wallets():
    rows = build_balance_rows(
        [
            {
                "id": "eth-whale-1",
                "chain": "ethereum",
                "address": "0xabc",
                "owner_label": "Binance Cold",
                "owner_category": "exchange",
                "approx_balance": "125k ETH",
                "is_active": "true",
            },
            {
                "id": "",
                "chain": "ethereum",
                "address": "0xdef",
            },
        ],
        refreshed_at="2026-04-18T00:00:00+00:00",
    )

    assert len(rows) == 1
    assert rows[0]["wallet_id"] == "eth-whale-1"
    assert rows[0]["updated_at"] == "2026-04-18T00:00:00+00:00"


def test_upsert_curated_wallet_balances_updates_existing_wallet():
    client, mock_ss = _make_client()
    mock_ws = MagicMock()
    mock_ss.worksheet.return_value = mock_ws

    existing = [""] * len(CURATED_WALLET_BALANCES_HEADERS)
    existing[CURATED_WALLET_BALANCES_HEADERS.index("wallet_id")] = "eth-whale-1"
    existing[CURATED_WALLET_BALANCES_HEADERS.index("chain")] = "ethereum"
    existing[CURATED_WALLET_BALANCES_HEADERS.index("address")] = "0xabc"
    existing[CURATED_WALLET_BALANCES_HEADERS.index("approx_balance")] = "100k ETH"
    mock_ws.get_all_values.return_value = [CURATED_WALLET_BALANCES_HEADERS, existing]

    result = client.upsert_curated_wallet_balances(
        [
            {
                "wallet_id": "eth-whale-1",
                "chain": "ethereum",
                "address": "0xabc",
                "approx_balance": "125k ETH",
                "owner_label": "Binance Cold",
            }
        ]
    )

    assert result == {"inserted": 0, "updated": 1, "invalid": 0}
    mock_ws.update.assert_called_once()
    written = mock_ws.update.call_args[0][1][0]
    assert written[CURATED_WALLET_BALANCES_HEADERS.index("approx_balance")] == "125k ETH"


def test_upsert_curated_wallet_balances_appends_new_wallet():
    client, mock_ss = _make_client()
    mock_ws = MagicMock()
    mock_ss.worksheet.return_value = mock_ws
    mock_ws.get_all_values.return_value = [CURATED_WALLET_BALANCES_HEADERS]

    result = client.upsert_curated_wallet_balances(
        [
            {
                "wallet_id": "eth-whale-2",
                "chain": "ethereum",
                "address": "0xdef",
                "owner_label": "Coinbase Cold",
                "owner_category": "exchange",
                "approx_balance": "80k ETH",
            }
        ]
    )

    assert result == {"inserted": 1, "updated": 0, "invalid": 0}
    mock_ws.append_row.assert_called_once()

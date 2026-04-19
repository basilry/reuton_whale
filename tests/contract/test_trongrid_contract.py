from __future__ import annotations

import os

import pytest

from tests.contract._helpers import (
    assert_any_key,
    assert_required_keys,
    contract_sample_address,
    require_contract_base_url,
)


@pytest.mark.contract
def test_trongrid_account_transactions_schema(contract_session) -> None:
    base_url = require_contract_base_url("TRONGRID_API_BASE")
    address = contract_sample_address(
        "TRONGRID_CONTRACT_ADDRESS",
        "TFtbBrsWw5DGHoKQE8VY2WzTY3VnanQ2hz",
    )

    headers: dict[str, str] = {}
    api_key = os.getenv("TRONGRID_API_KEY", "").strip()
    if api_key:
        headers["TRON-PRO-API-KEY"] = api_key

    response = contract_session.get(
        f"{base_url}/v1/accounts/{address}/transactions",
        params={"limit": 1, "only_confirmed": "true", "order_by": "block_timestamp,desc"},
        headers=headers or None,
        timeout=15,
    )
    response.raise_for_status()

    payload = response.json()
    assert isinstance(payload, dict)
    assert_required_keys(payload, "data")

    rows = payload["data"]
    assert isinstance(rows, list)
    if rows:
        row = rows[0]
        assert isinstance(row, dict)
        assert_any_key(row, "txID", "transaction_id", "hash")
        assert_any_key(row, "block_timestamp", "raw_data")

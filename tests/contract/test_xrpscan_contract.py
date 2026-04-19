from __future__ import annotations

import pytest

from tests.contract._helpers import (
    assert_any_key,
    assert_required_keys,
    contract_sample_address,
    require_contract_base_url,
)


@pytest.mark.contract
def test_xrpscan_account_transactions_schema(contract_session) -> None:
    base_url = require_contract_base_url("XRPSCAN_API_BASE")
    address = contract_sample_address(
        "XRPSCAN_CONTRACT_ADDRESS",
        "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv",
    )

    response = contract_session.get(
        f"{base_url}/account/{address}/transactions",
        params={"limit": 1},
        timeout=15,
    )
    response.raise_for_status()

    payload = response.json()
    assert isinstance(payload, dict)
    assert_required_keys(payload, "transactions")

    rows = payload["transactions"]
    assert isinstance(rows, list)
    if rows:
        row = rows[0]
        assert isinstance(row, dict)
        assert_required_keys(row, "meta", "validated")
        assert_any_key(row, "hash", "tx")

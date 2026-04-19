from __future__ import annotations

import pytest

from tests.contract._helpers import (
    assert_any_key,
    assert_required_keys,
    contract_sample_address,
    require_contract_base_url,
)


@pytest.mark.contract
def test_blockchair_doge_dashboard_schema(contract_session) -> None:
    base_url = require_contract_base_url("DOGE_INDEXER_BASE")
    address = contract_sample_address(
        "DOGE_CONTRACT_ADDRESS",
        "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L",
    )

    response = contract_session.get(
        f"{base_url}/dashboards/address/{address}",
        params={"limit": 1},
        timeout=15,
    )
    response.raise_for_status()

    payload = response.json()
    assert isinstance(payload, dict)
    assert_required_keys(payload, "data")
    assert isinstance(payload["data"], dict)
    assert address in payload["data"]

    dashboard = payload["data"][address]
    assert isinstance(dashboard, dict)
    assert_any_key(dashboard, "utxo", "utxos")

    utxos = dashboard.get("utxo") or dashboard.get("utxos") or []
    assert isinstance(utxos, list)
    if utxos:
        row = utxos[0]
        assert isinstance(row, dict)
        assert_any_key(row, "transaction_hash", "hash", "txid")
        assert_required_keys(row, "value")
        assert_any_key(row, "index", "output_index", "n")

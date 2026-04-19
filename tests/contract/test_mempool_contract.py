from __future__ import annotations

import pytest

from tests.contract._helpers import (
    assert_required_keys,
    contract_sample_address,
    require_contract_base_url,
)


@pytest.mark.contract
def test_mempool_address_txs_schema(contract_session) -> None:
    base_url = require_contract_base_url("BTC_INDEXER_BASE")
    address = contract_sample_address(
        "BTC_CONTRACT_ADDRESS",
        "3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6",
    )

    response = contract_session.get(
        f"{base_url}/address/{address}/txs",
        timeout=15,
    )
    response.raise_for_status()

    data = response.json()
    assert isinstance(data, list)
    if data:
        tx = data[0]
        assert isinstance(tx, dict)
        assert_required_keys(tx, "txid", "vin", "vout", "status")

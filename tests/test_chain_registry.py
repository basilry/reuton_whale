from __future__ import annotations

from src.ingestion.etherscan import EtherscanCollector
from src.ingestion.registry import ChainCollectorRegistry
from src.ingestion.solscan import SolscanCollector


def test_registry_groups_evm_and_sol_addresses_and_surfaces_unsupported() -> None:
    registry = ChainCollectorRegistry()
    registry.register(EtherscanCollector(api_key="test"))
    registry.register(SolscanCollector())

    grouped = registry.group_addresses(
        {
            "0xeth": {"chain": "ETH"},
            "0xeth2": {"chain": "ethereum"},
            "0xevm": {"chain": "EVM"},
            "0xblank": {"chain": ""},
            "So111": {"chain": "SOL"},
            "So222": {"chain": "solana"},
            "btc1": {"chain": "BTC"},
        }
    )

    assert grouped.supported["ETH"] == ["0xeth", "0xeth2", "0xevm", "0xblank"]
    assert grouped.supported["ARB"] == ["0xevm", "0xblank"]
    assert grouped.supported["BASE"] == ["0xevm", "0xblank"]
    assert grouped.supported["BSC"] == ["0xevm", "0xblank"]
    assert grouped.supported["POLYGON"] == ["0xevm", "0xblank"]
    assert grouped.supported["SOL"] == ["So111", "So222"]
    assert grouped.unsupported_counts == {"BTC": 1}

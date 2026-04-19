from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

from src.ingestion.etherscan import EtherscanCollector
from src.ingestion.solscan import SolscanCollector
from src.pipeline.common import collect_recent_events
from src.signals.models import Event


class _FakeSheets:
    def list_watched_addresses(self) -> dict[str, dict]:
        return {
            "0xeth": {"chain": "ETH"},
            "0xevm": {"chain": "EVM"},
            "0xblank": {"chain": ""},
            "So111": {"chain": "SOL"},
            "btc1": {"chain": "BTC"},
        }

    def list_tg_whale_events(self, since=None) -> list[dict]:
        return []


def _event(chain: str, tx_hash: str) -> Event:
    now = datetime.now(timezone.utc)
    return Event(
        source="chain",
        chain=chain,
        tx_hash=tx_hash,
        watched_address="watch",
        from_addr="from",
        to_addr="to",
        direction="in",
        token=chain,
        amount_token=1.0,
        amount_usd=None,
        counterparty_category="unknown",
        block_time=now,
        collected_at=now,
    )


def test_collect_recent_events_keeps_existing_evm_sol_behavior_and_reports_unsupported() -> None:
    eth_collector = EtherscanCollector(api_key="test")
    sol_collector = SolscanCollector()
    eth_collector.fetch = MagicMock(
        side_effect=lambda addrs, chain, since_ts, **kwargs: [_event(chain, f"{chain}:{len(addrs)}")]
    )
    sol_collector.fetch = MagicMock(
        side_effect=lambda addrs, chain, since_ts, **kwargs: [_event(chain, f"{chain}:{len(addrs)}")]
    )

    collected = collect_recent_events(
        sheets=_FakeSheets(),
        price_service=object(),
        eth_collector=eth_collector,
        sol_collector=sol_collector,
        event_to_dict=lambda event: {"hash": event.tx_hash, "chain": event.chain},
    )

    assert eth_collector.fetch.call_count == 5
    assert {call.args[1] for call in eth_collector.fetch.call_args_list} == {
        "ETH",
        "ARB",
        "BASE",
        "BSC",
        "POLYGON",
    }
    assert eth_collector.fetch.call_args_list[0].args[0] == ["0xeth", "0xevm", "0xblank"]
    assert sol_collector.fetch.call_count == 1
    assert sol_collector.fetch.call_args.args[0] == ["So111"]
    assert sol_collector.fetch.call_args.args[1] == "SOL"

    assert len(collected.chain_events) == 6
    assert collected.transactions == [
        {"hash": "ETH:3", "chain": "ETH"},
        {"hash": "ARB:2", "chain": "ARB"},
        {"hash": "BASE:2", "chain": "BASE"},
        {"hash": "BSC:2", "chain": "BSC"},
        {"hash": "POLYGON:2", "chain": "POLYGON"},
        {"hash": "SOL:1", "chain": "SOL"},
    ]
    assert "unsupported_chains=BTC=1" in collected.errors
    assert collected.coverage["supported_chains"] == "ETH,ARB,BASE,BSC,POLYGON,SOL"
    assert collected.coverage["unsupported_chain_count"] == 1
    assert collected.coverage["unsupported_chain_names"] == "BTC=1"
    assert collected.coverage["per_chain_event_count"] == "ARB=1,BASE=1,BSC=1,ETH=1,POLYGON=1,SOL=1"

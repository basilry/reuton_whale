"""Tests for normalize_chain_tx."""
from datetime import datetime, timezone

from src.ingestion.normalizer import normalize_chain_tx
from src.signals.models import Event


def _base_raw(chain="ETH", **overrides):
    row = {
        "_chain": chain,
        "_watched_address": "0xwatch",
        "hash": "0xabc",
        "timeStamp": "1700000000",
        "from": "0xwatch",
        "to": "0xother",
        "value": "1000000000000000000",  # 1 ETH
    }
    row.update(overrides)
    return row


class TestNormalizeChainTx:
    def test_basic_eth_out(self):
        evt = normalize_chain_tx(_base_raw(), "ETH", {}, None)
        assert isinstance(evt, Event)
        assert evt.source == "chain"
        assert evt.chain == "ETH"
        assert evt.tx_hash == "0xabc"
        assert evt.direction == "out"
        assert abs(evt.amount_token - 1.0) < 1e-9
        assert evt.token == "ETH"

    def test_direction_in_when_watched_is_to(self):
        raw = _base_raw(**{"from": "0xsender", "to": "0xwatch"})
        evt = normalize_chain_tx(raw, "ETH", {}, None)
        assert evt.direction == "in"

    def test_token_tx_uses_token_symbol_and_decimals(self):
        raw = _base_raw(tokenSymbol="USDT", tokenDecimal="6", value="2000000000")  # 2000 USDT
        evt = normalize_chain_tx(raw, "ETH", {}, None)
        assert evt.token == "USDT"
        assert abs(evt.amount_token - 2000.0) < 0.01

    def test_sol_lamport_division(self):
        raw = {
            "_chain": "SOL",
            "_watched_address": "addr1",
            "hash": "sig1",
            "timeStamp": "1700000000",
            "from": "addr1",
            "to": "addr2",
            "lamport": "2000000000",  # 2 SOL
        }
        evt = normalize_chain_tx(raw, "SOL", {}, None)
        assert evt.token == "SOL"
        assert abs(evt.amount_token - 2.0) < 1e-6

    def test_counterparty_category_lookup(self):
        raw = _base_raw(**{"from": "0xwatch", "to": "0xcex"})
        watched_index = {"0xcex": {"address": "0xcex", "category": "cex"}}
        evt = normalize_chain_tx(raw, "ETH", watched_index, None)
        assert evt.counterparty_category == "cex"

    def test_no_counterparty_category_when_not_in_index(self):
        evt = normalize_chain_tx(_base_raw(), "ETH", {}, None)
        assert evt.counterparty_category is None

    def test_price_service_populates_amount_usd(self):
        mock_ps = type("PS", (), {"get_usd": staticmethod(lambda sym, ts=None: 2000.0 if sym == "ETH" else None)})()
        evt = normalize_chain_tx(_base_raw(), "ETH", {}, mock_ps)
        assert abs(evt.amount_usd - 2000.0) < 0.01

    def test_block_time_from_timestamp(self):
        raw = _base_raw(timeStamp="1700000000")
        evt = normalize_chain_tx(raw, "ETH", {}, None)
        assert evt.block_time == datetime.fromtimestamp(1700000000, tz=timezone.utc)

    def test_zero_timestamp_defaults_to_now(self):
        raw = _base_raw(timeStamp="0")
        evt = normalize_chain_tx(raw, "ETH", {}, None)
        assert evt.block_time is not None

    def test_solscan_src_dst_fields(self):
        raw = {
            "_chain": "SOL",
            "_watched_address": "src_addr",
            "txHash": "sig2",
            "timeStamp": "1700000000",
            "src": "src_addr",
            "dst": "dst_addr",
            "lamport": "1000000000",
        }
        evt = normalize_chain_tx(raw, "SOL", {}, None)
        assert evt.from_addr == "src_addr"
        assert evt.to_addr == "dst_addr"
        assert evt.tx_hash == "sig2"

import pytest

from src.analyzer.scoring import TransactionScorer


@pytest.fixture
def scorer():
    return TransactionScorer()


def _make_tx(**overrides):
    base = {
        "hash": "abc123",
        "symbol": "BTC",
        "amount": 100,
        "amount_usd": 5_000_000,
        "from_owner_type": "unknown",
        "from_owner": "unknown",
        "to_owner_type": "unknown",
        "to_owner": "unknown",
        "blockchain": "bitcoin",
    }
    base.update(overrides)
    return base


class TestCalculateBaseScore:
    def test_above_50m(self, scorer):
        assert scorer.calculate_base_score(_make_tx(amount_usd=60_000_000)) == 7.0

    def test_above_10m(self, scorer):
        assert scorer.calculate_base_score(_make_tx(amount_usd=15_000_000)) == 6.0

    def test_above_1m(self, scorer):
        assert scorer.calculate_base_score(_make_tx(amount_usd=2_000_000)) == 5.0

    def test_below_1m(self, scorer):
        assert scorer.calculate_base_score(_make_tx(amount_usd=500_000)) == 3.0

    def test_exchange_deposit_bonus(self, scorer):
        tx = _make_tx(amount_usd=2_000_000, to_owner_type="exchange")
        assert scorer.calculate_base_score(tx) == 7.0  # 5 + 2

    def test_exchange_withdrawal_bonus(self, scorer):
        tx = _make_tx(amount_usd=2_000_000, from_owner_type="exchange")
        assert scorer.calculate_base_score(tx) == 6.0  # 5 + 1

    def test_repeat_bonus(self, scorer):
        tx = _make_tx(amount_usd=2_000_000, repeat_count=3)
        assert scorer.calculate_base_score(tx) == 6.0  # 5 + 1

    def test_all_bonuses(self, scorer):
        tx = _make_tx(amount_usd=60_000_000, to_owner_type="exchange", repeat_count=2)
        assert scorer.calculate_base_score(tx) == 10.0  # 7 + 2 + 1


class TestPreFilter:
    def test_filters_below_1m(self, scorer):
        txs = [_make_tx(amount_usd=500_000), _make_tx(amount_usd=2_000_000)]
        result = scorer.pre_filter(txs)
        assert len(result) == 1
        assert result[0]["amount_usd"] == 2_000_000

    def test_max_30(self, scorer):
        txs = [_make_tx(amount_usd=2_000_000 + i) for i in range(50)]
        result = scorer.pre_filter(txs)
        assert len(result) == 30

    def test_exchange_priority(self, scorer):
        txs = [
            _make_tx(amount_usd=2_000_000, to_owner_type="unknown"),
            _make_tx(amount_usd=2_000_000, to_owner_type="exchange"),
        ]
        result = scorer.pre_filter(txs)
        assert result[0]["to_owner_type"] == "exchange"

    def test_empty_input(self, scorer):
        assert scorer.pre_filter([]) == []


class TestRankByImportance:
    def test_returns_top_5(self, scorer):
        analyzed = [{"importance_score": i} for i in range(10)]
        result = scorer.rank_by_importance(analyzed)
        assert len(result) == 5
        assert result[0]["importance_score"] == 9

    def test_fewer_than_5(self, scorer):
        analyzed = [{"importance_score": 8}, {"importance_score": 3}]
        result = scorer.rank_by_importance(analyzed)
        assert len(result) == 2

    def test_empty(self, scorer):
        assert scorer.rank_by_importance([]) == []

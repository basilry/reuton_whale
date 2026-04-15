from datetime import datetime, timedelta, timezone

from src.signals.baseline import build_chain_baselines


class FakeStorage:
    def __init__(self, rows):
        self.rows = rows
        self.since = None

    def list_address_activity(self, since=None):
        self.since = since
        return self.rows


def _row(day: datetime, direction: str, amount_usd: float, chain: str = "ETH") -> dict:
    return {
        "chain": chain,
        "block_time": day.isoformat(),
        "direction": direction,
        "counterparty_category": "cex",
        "amount_usd": amount_usd,
    }


def test_build_chain_baselines_returns_default_and_chain_stats():
    as_of = datetime(2026, 4, 15, tzinfo=timezone.utc)
    rows = []
    for idx in range(7):
        day = as_of - timedelta(days=idx + 1)
        rows.append(_row(day, "out", 1_000_000 + idx * 100_000))
        rows.append(_row(day, "in", 500_000 + idx * 50_000))

    storage = FakeStorage(rows)
    result = build_chain_baselines(storage, as_of, lookback_days=14)

    assert storage.since == as_of - timedelta(days=14)
    assert result["default"]["n"] == 7
    assert result["default"]["out_mean_usd"] == 1_300_000
    assert result["default"]["in_mean_usd"] == 650_000
    assert result["default"]["out_std_usd"] > 1
    assert result["eth"]["n"] == 7


def test_build_chain_baselines_omits_low_sample_data():
    as_of = datetime(2026, 4, 15, tzinfo=timezone.utc)
    rows = [
        _row(as_of - timedelta(days=1), "out", 1_000_000),
        _row(as_of - timedelta(days=2), "out", 1_100_000),
        _row(as_of - timedelta(days=3), "out", 1_200_000),
    ]

    assert build_chain_baselines(FakeStorage(rows), as_of) == {}


def test_build_chain_baselines_ignores_non_cex_rows():
    as_of = datetime(2026, 4, 15, tzinfo=timezone.utc)
    rows = []
    for idx in range(7):
        day = as_of - timedelta(days=idx + 1)
        row = _row(day, "out", 1_000_000)
        row["counterparty_category"] = "bridge"
        rows.append(row)

    assert build_chain_baselines(FakeStorage(rows), as_of) == {}


def test_build_chain_baselines_returns_empty_for_non_list_storage_result():
    as_of = datetime(2026, 4, 15, tzinfo=timezone.utc)

    class BadStorage:
        def list_address_activity(self, since=None):
            return object()

    assert build_chain_baselines(BadStorage(), as_of) == {}

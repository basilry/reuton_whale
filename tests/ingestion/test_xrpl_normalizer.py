from datetime import timezone

from src.ingestion.xrpl import normalize_xrpl_payment


def _entry(
    *,
    watched: str = "rWatch",
    counterparty: str = "rCounterparty",
    tx_hash: str = "HASH1",
    amount: object = "5000000",
    delivered_amount: object = "5000000",
    iso_time: str = "2026-04-19T09:15:00Z",
    tx_type: str = "Payment",
) -> dict:
    return {
        "validated": True,
        "close_time_iso": iso_time,
        "tx": {
            "hash": tx_hash,
            "TransactionType": tx_type,
            "Account": watched,
            "Destination": counterparty,
            "Amount": amount,
        },
        "meta": {
            "TransactionResult": "tesSUCCESS",
            "delivered_amount": delivered_amount,
        },
    }


class _PriceService:
    def get_usd(self, token: str) -> float:
        assert token == "XRP"
        return 0.5


def test_normalize_xrpl_payment_builds_native_xrp_event() -> None:
    event = normalize_xrpl_payment(
        _entry(),
        watched_address="rWatch",
        watched_index={"rCounterparty": {"category": "exchange"}},
        price_service=_PriceService(),
    )

    assert event is not None
    assert event.chain == "XRP"
    assert event.token == "XRP"
    assert event.direction == "out"
    assert event.amount_token == 5.0
    assert event.amount_usd == 2.5
    assert event.counterparty_category == "exchange"
    assert event.block_time.tzinfo == timezone.utc


def test_normalize_xrpl_payment_uses_delivered_amount_when_present() -> None:
    event = normalize_xrpl_payment(
        _entry(amount="7000000", delivered_amount="3000000"),
        watched_address="rWatch",
    )

    assert event is not None
    assert event.amount_token == 3.0


def test_normalize_xrpl_payment_skips_non_native_or_non_payment_rows() -> None:
    issued_currency = _entry(
        amount={"currency": "USD", "value": "10", "issuer": "rIssuer"},
        delivered_amount={"currency": "USD", "value": "10", "issuer": "rIssuer"},
    )
    non_payment = _entry(tx_type="OfferCreate")

    assert normalize_xrpl_payment(issued_currency, watched_address="rWatch") is None
    assert normalize_xrpl_payment(non_payment, watched_address="rWatch") is None

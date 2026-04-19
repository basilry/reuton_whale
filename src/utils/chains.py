from __future__ import annotations

_ALIAS = {
    "bitcoin": "BTC",
    "btc": "BTC",
    "ethereum": "ETH",
    "eth": "ETH",
    "evm": "ETH",
    "solana": "SOL",
    "sol": "SOL",
    "ripple": "XRP",
    "xrp": "XRP",
    "tron": "TRX",
    "trx": "TRX",
    "dogecoin": "DOGE",
    "doge": "DOGE",
    "toncoin": "TON",
    "ton": "TON",
    "arbitrum": "ARB",
    "arb": "ARB",
    "base": "BASE",
    "bsc": "BSC",
    "bnb": "BSC",
    "polygon": "POLYGON",
    "matic": "POLYGON",
}

EVM_CHAINS = frozenset({"ETH", "ARB", "BASE", "BSC", "POLYGON"})


def canonical_chain(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return _ALIAS.get(raw.lower(), raw.upper())


def is_evm_chain(value: object) -> bool:
    return canonical_chain(value) in EVM_CHAINS

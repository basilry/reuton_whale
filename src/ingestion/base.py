from __future__ import annotations

from abc import ABC, abstractmethod

from src.signals.models import Event


class ChainCollector(ABC):
    supported_chains: tuple[str, ...] = ()
    chain_aliases: dict[str, str] = {}
    expanded_aliases: dict[str, tuple[str, ...]] = {}

    def normalize_chain(self, chain: object) -> str | None:
        raw = str(chain or "").strip()
        if not raw:
            raw = ""
        canonical = self.chain_aliases.get(raw) or self.chain_aliases.get(raw.lower())
        if canonical:
            return canonical
        upper = raw.upper()
        if upper in self.supported_chains:
            return upper
        lower = raw.lower()
        return self.chain_aliases.get(lower)

    def expand_chain(self, chain: object) -> tuple[str, ...]:
        raw = str(chain or "").strip()
        expanded = self.expanded_aliases.get(raw) or self.expanded_aliases.get(raw.upper())
        if expanded:
            return expanded
        normalized = self.normalize_chain(raw)
        if normalized:
            return (normalized,)
        return ()

    @abstractmethod
    def fetch(
        self,
        addresses: list[str],
        chain: str,
        since_ts: int,
        *,
        watched_index: dict | None = None,
        price_service=None,
    ) -> list[Event]:
        raise NotImplementedError

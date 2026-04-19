from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from src.ingestion.base import ChainCollector


@dataclass(frozen=True)
class GroupedAddresses:
    supported: dict[str, list[str]]
    unsupported_counts: dict[str, int]


class ChainCollectorRegistry:
    def __init__(self) -> None:
        self._collectors: list[ChainCollector] = []
        self._collectors_by_chain: dict[str, ChainCollector] = {}

    def register(self, collector: ChainCollector) -> None:
        for chain in collector.supported_chains:
            existing = self._collectors_by_chain.get(chain)
            if existing is not None and existing is not collector:
                raise ValueError(f"Collector already registered for chain {chain}")
            self._collectors_by_chain[chain] = collector
        self._collectors.append(collector)

    @property
    def supported_chains(self) -> tuple[str, ...]:
        return tuple(self._collectors_by_chain.keys())

    def collector_for(self, chain: str) -> ChainCollector | None:
        return self._collectors_by_chain.get(chain)

    def is_empty(self) -> bool:
        return not self._collectors_by_chain

    def group_addresses(self, watched_index: dict[str, dict]) -> GroupedAddresses:
        grouped: dict[str, list[str]] = {chain: [] for chain in self.supported_chains}
        unsupported_counts: dict[str, int] = defaultdict(int)
        seen_per_chain: dict[str, set[str]] = defaultdict(set)

        for address, row in watched_index.items():
            targets = self._expand_targets(row.get("chain"))
            if not targets:
                unsupported_counts[self._display_chain(row.get("chain"))] += 1
                continue
            for chain in targets:
                if address in seen_per_chain[chain]:
                    continue
                grouped.setdefault(chain, []).append(address)
                seen_per_chain[chain].add(address)

        return GroupedAddresses(
            supported={chain: addrs for chain, addrs in grouped.items() if addrs},
            unsupported_counts=dict(sorted(unsupported_counts.items())),
        )

    def _expand_targets(self, raw_chain: object) -> tuple[str, ...]:
        targets: list[str] = []
        seen: set[str] = set()
        for collector in self._collectors:
            for chain in collector.expand_chain(raw_chain):
                if chain in seen:
                    continue
                seen.add(chain)
                targets.append(chain)
        return tuple(targets)

    @staticmethod
    def _display_chain(raw_chain: object) -> str:
        value = str(raw_chain or "").strip()
        if not value:
            return "EVM"
        return value.upper()

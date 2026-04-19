from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from typing import Literal

import yaml
from dotenv import load_dotenv

from src.analyzer.price_service import PriceService
from src.ingestion.base import ChainCollector
from src.ingestion.etherscan import EtherscanCollector
from src.ingestion.registry import ChainCollectorRegistry
from src.ingestion.solscan import SolscanCollector
from src.ingestion.tg_normalizer import tg_row_to_event
from src.llm.router import LLMRouter
from src.signals.baseline import build_chain_baselines
from src.signals.engine import SignalEngine
from src.signals.formatters import signal_to_sheet_dict
from src.signals.models import Event, Signal
from src.storage.sheets_client import SheetsClient
from src.storage.queries import now_iso
from src.utils.logger import get_logger
from src.utils.datetime_utils import parse_dt

logger = get_logger("pipeline.common")
_LLM_ROUTING_CONFIG = Path(__file__).resolve().parents[2] / "config" / "llm_routing.yaml"

SignalSeverity = Literal["low", "medium", "high", "critical"]
SignalConfidence = Literal["low", "medium", "high"]
SignalSource = Literal["tg", "chain", "both"]


@dataclass
class CollectedEvents:
    raw_events: list[Event]
    chain_events: list[Event]
    transactions: list[dict]
    errors: list[str]
    coverage: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class PipelineEnv:
    sheet_id: str
    google_credentials: str
    etherscan_api_key: str = ""
    solscan_api_key: str = ""
    anthropic_api_key: str = ""
    gemini_api_key: str = ""
    groq_api_key: str = ""
    telegram_token: str = ""
    telegram_broadcast_chat: str = "@whalescope_alertz"
    telegram_broadcast_token: str = ""
    telegram_broadcast_enabled: bool = False
    telegram_broadcast_dry_run: bool = True


def coerce_json_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    raw = str(value or "").strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(item) for item in parsed if str(item).strip()]
    except json.JSONDecodeError:
        pass
    return [item.strip() for item in raw.split(",") if item.strip()]


def coerce_json_dict(value: object) -> dict:
    if isinstance(value, dict):
        return value
    raw = str(value or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def safe_float(value: object) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def env_bool(name: str, *, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def load_pipeline_env(
    *,
    require_chain_api: bool = False,
    require_llm: bool = False,
    require_telegram: bool = False,
) -> PipelineEnv:
    load_dotenv()

    sheet_id = require_env("GOOGLE_SHEET_ID")
    google_credentials = require_env("GOOGLE_CREDENTIALS_JSON")
    etherscan_api_key = os.getenv("ETHERSCAN_API_KEY", "").strip()
    solscan_api_key = os.getenv("SOLSCAN_API_KEY", "").strip()
    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
    groq_api_key = os.getenv("GROQ_API_KEY", "").strip()
    telegram_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()

    if require_chain_api and not etherscan_api_key:
        raise ValueError("Missing required environment variable: ETHERSCAN_API_KEY")
    if require_llm and not any((anthropic_api_key, gemini_api_key, groq_api_key)):
        raise ValueError(
            "Missing required LLM provider key: set at least one of "
            "ANTHROPIC_API_KEY, GEMINI_API_KEY, or GROQ_API_KEY"
        )
    if require_telegram and not telegram_token:
        raise ValueError("Missing required environment variable: TELEGRAM_BOT_TOKEN")

    return PipelineEnv(
        sheet_id=sheet_id,
        google_credentials=google_credentials,
        etherscan_api_key=etherscan_api_key,
        solscan_api_key=solscan_api_key,
        anthropic_api_key=anthropic_api_key,
        gemini_api_key=gemini_api_key,
        groq_api_key=groq_api_key,
        telegram_token=telegram_token,
        telegram_broadcast_chat=os.getenv("TELEGRAM_BROADCAST_CHAT", "@whalescope_alertz").strip(),
        telegram_broadcast_token=os.getenv("TELEGRAM_BROADCAST_BOT_TOKEN", "").strip(),
        telegram_broadcast_enabled=env_bool("TELEGRAM_BROADCAST_ENABLED", default=False),
        telegram_broadcast_dry_run=env_bool("TELEGRAM_BROADCAST_DRY_RUN", default=True),
    )


def build_router_from_env(env: PipelineEnv) -> LLMRouter:
    providers = {}
    if env.anthropic_api_key:
        from src.llm.anthropic_provider import AnthropicProvider

        providers["anthropic"] = AnthropicProvider(env.anthropic_api_key)
    if env.gemini_api_key:
        try:
            from src.llm.gemini_provider import GeminiProvider

            providers["gemini"] = GeminiProvider(env.gemini_api_key)
        except Exception as exc:
            logger.warning("GeminiProvider init failed: %s", exc)
    if env.groq_api_key:
        try:
            from src.llm.groq_provider import GroqProvider

            providers["groq"] = GroqProvider(env.groq_api_key)
        except Exception as exc:
            logger.warning("GroqProvider init failed: %s", exc)

    with open(_LLM_ROUTING_CONFIG) as handle:
        routing_cfg = yaml.safe_load(handle)

    return LLMRouter(providers=providers, routing_config=routing_cfg, logger=logger)


def build_sheets_client(env: PipelineEnv) -> SheetsClient:
    return SheetsClient(env.sheet_id, env.google_credentials)


def build_price_services(env: PipelineEnv) -> tuple[PriceService, EtherscanCollector | None, SolscanCollector | None]:
    price_service = PriceService()
    eth_collector = EtherscanCollector(env.etherscan_api_key) if env.etherscan_api_key else None
    sol_collector = SolscanCollector(env.solscan_api_key or None)
    return price_service, eth_collector, sol_collector


def build_collector_registry(*collectors: ChainCollector | None) -> ChainCollectorRegistry:
    registry = ChainCollectorRegistry()
    for collector in collectors:
        if collector is None:
            continue
        registry.register(collector)
    return registry


def _format_chain_counts(counts: dict[str, int]) -> str:
    if not counts:
        return ""
    return ",".join(f"{chain}={count}" for chain, count in sorted(counts.items()))


def normalize_signal_severity(value: object) -> SignalSeverity:
    normalized = str(value or "").strip().lower()
    if normalized in {"low", "medium", "high", "critical"}:
        return normalized  # type: ignore[return-value]
    return "medium"


def normalize_signal_confidence(value: object) -> SignalConfidence:
    normalized = str(value or "").strip().lower()
    if normalized in {"low", "medium", "high"}:
        return normalized  # type: ignore[return-value]
    return "medium"


def normalize_signal_source(value: object) -> SignalSource:
    normalized = str(value or "").strip().lower()
    if normalized in {"tg", "chain", "both"}:
        return normalized  # type: ignore[return-value]
    return "chain"


def signal_row_to_signal(row: dict) -> Signal | None:
    signal_id = str(row.get("signal_id", "")).strip()
    window_start = parse_dt(row.get("window_start"))
    window_end = parse_dt(row.get("window_end"))
    if not signal_id or window_start is None or window_end is None:
        return None

    extra = coerce_json_dict(row.get("extra_json"))
    return Signal(
        signal_id=signal_id,
        rule=str(row.get("rule", "")).strip() or "signal",
        severity=normalize_signal_severity(row.get("severity")),
        score=safe_float(row.get("score")),
        confidence=normalize_signal_confidence(row.get("confidence")),
        source=normalize_signal_source(row.get("source")),
        evidence_tx_hashes=coerce_json_list(row.get("evidence_tx_hashes")),
        window_start=window_start,
        window_end=window_end,
        summary=str(row.get("summary", "")).strip(),
        extra=extra,
        asset=str(extra.get("asset") or extra.get("symbol") or "").strip() or None,
        exchange=str(extra.get("exchange") or "").strip() or None,
        flow_direction=str(extra.get("flow_direction") or "").strip() or None,
        quote_basis=str(extra.get("quote_basis") or "").strip() or None,
    )


def init_run_result(run_type: str) -> dict[str, object]:
    started_at = now_iso()
    return {
        "run_id": f"{run_type}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
        "run_type": run_type,
        "status": "started",
        "started_at": started_at,
        "finished_at": "",
        "transactions_count": 0,
        "errors": "",
        "details": "",
    }


def signal_row_to_top_item(row: dict) -> dict:
    extra = coerce_json_dict(row.get("extra_json"))
    evidence_hashes = coerce_json_list(row.get("evidence_tx_hashes"))
    amount_usd_raw = (
        extra.get("amount_usd")
        or extra.get("total_usd")
        or extra.get("notional_usd")
    )
    amount_usd = safe_float(amount_usd_raw) if amount_usd_raw not in (None, "") else None
    return {
        "hash": evidence_hashes[0] if evidence_hashes else "",
        "symbol": str(extra.get("asset") or extra.get("symbol") or extra.get("token") or row.get("rule") or ""),
        "chain": str(extra.get("chain") or ""),
        "amount_usd": amount_usd,
        "amount_usd_known": amount_usd is not None,
        "importance_score": safe_float(row.get("score")),
        "interpretation": str(row.get("summary") or ""),
        "type": str(row.get("rule") or ""),
        "signal_id": str(row.get("signal_id") or ""),
        "rule": str(row.get("rule") or ""),
        "severity": str(row.get("severity") or ""),
        "source": str(row.get("source") or ""),
        "confidence": str(row.get("confidence") or ""),
        "evidence_count": len(evidence_hashes),
        "window_start": str(row.get("window_start") or ""),
        "window_end": str(row.get("window_end") or ""),
        "summary": str(row.get("summary") or ""),
        "extra": extra,
    }


def collect_recent_events(
    *,
    sheets: SheetsClient,
    price_service: PriceService,
    eth_collector: EtherscanCollector | None,
    sol_collector: SolscanCollector | None,
    event_to_dict,
    since: datetime | None = None,
) -> CollectedEvents:
    since_dt = since or (datetime.now(timezone.utc) - timedelta(hours=24))
    since_ts = int(since_dt.timestamp())
    errors: list[str] = []
    raw_events: list[Event] = []
    coverage: dict[str, object] = {}

    try:
        watched_index = sheets.list_watched_addresses()
        registry = build_collector_registry(eth_collector, sol_collector)
        grouped = registry.group_addresses(watched_index)

        supported_chains = ",".join(registry.supported_chains)
        unsupported_chain_count = sum(grouped.unsupported_counts.values())
        unsupported_chain_names = _format_chain_counts(grouped.unsupported_counts)

        coverage.update(
            supported_chains=supported_chains,
            unsupported_chain_count=unsupported_chain_count,
            unsupported_chain_names=unsupported_chain_names,
        )

        if grouped.unsupported_counts:
            message = f"unsupported_chains={unsupported_chain_names}"
            errors.append(message)
            logger.warning("Silent drop guard triggered: %s", message)

        for chain, addrs in grouped.supported.items():
            collector = registry.collector_for(chain)
            if collector is None:
                continue
            try:
                raw_events.extend(
                    collector.fetch(
                        addrs,
                        chain,
                        since_ts,
                        watched_index=watched_index,
                        price_service=price_service,
                    )
                )
            except Exception as exc:
                errors.append(f"{chain}: {exc}")
                logger.error("Failed to collect chain events chain=%s: %s", chain, exc)

        try:
            tg_rows = sheets.list_tg_whale_events(since=since_dt)
            if tg_rows:
                raw_events.extend(
                    [tg_row_to_event(row) for row in tg_rows if isinstance(row, dict)]
                )
        except Exception as exc:  # defensive: listener issues must not stop chain ingest
            errors.append(f"list_tg_whale_events: {exc}")
            logger.error("Failed to load TG whale events: %s", exc)
    except Exception as exc:
        errors.append(f"collect_recent_events: {exc}")
        logger.error("Failed to collect recent events: %s", exc)

    chain_events = [event for event in raw_events if event.source == "chain"]
    transactions = [event_to_dict(event) for event in chain_events]
    coverage["per_chain_event_count"] = _format_chain_counts(dict(Counter(event.chain for event in chain_events)))
    return CollectedEvents(
        raw_events=raw_events,
        chain_events=chain_events,
        transactions=transactions,
        errors=errors,
        coverage=coverage,
    )


def persist_chain_activity(
    *,
    sheets: SheetsClient,
    chain_events: list[Event],
    event_to_address_activity,
    transactions: list[dict],
) -> dict[str, object]:
    errors: list[str] = []
    stored_activity = 0
    stored_transactions = 0

    if chain_events:
        try:
            address_rows = [event_to_address_activity(event) for event in chain_events]
            if address_rows:
                stored_activity = sheets.append_address_activity(address_rows)
        except Exception as exc:
            errors.append(f"append_address_activity: {exc}")
            logger.error("Failed to store address activity: %s", exc)

    if transactions:
        try:
            stored_transactions = sheets.append_transactions(transactions)
        except Exception as exc:
            errors.append(f"append_transactions: {exc}")
            logger.error("Failed to store transactions: %s", exc)

    return {
        "stored_activity": stored_activity,
        "stored_transactions": stored_transactions,
        "errors": errors,
    }


def log_unknown_price_symbols(*, sheets: SheetsClient, price_service: PriceService) -> list[str]:
    errors: list[str] = []
    unknown_price_symbols = price_service.drain_unknown_report()
    if not unknown_price_symbols:
        return errors

    try:
        sheets.append_system_log(
            "warning",
            "price_unknown_symbols",
            {
                "symbols": [
                    {"symbol": symbol, "count": count}
                    for symbol, count in unknown_price_symbols
                ],
            },
        )
    except Exception as exc:
        errors.append(f"price_unknown_symbols: {exc}")
        logger.warning("Failed to log unknown price symbols: %s", exc)
    return errors


def detect_signals(
    *,
    engine: SignalEngine,
    sheets: SheetsClient,
    raw_events: list[Event],
    now: datetime | None = None,
    dry_run: bool = False,
    baselines_builder=build_chain_baselines,
) -> tuple[list[Signal], list[str]]:
    current = now or datetime.now(timezone.utc)
    errors: list[str] = []
    if not raw_events:
        return [], errors

    try:
        baselines = {} if dry_run else baselines_builder(sheets, current)
        signals = engine.run(raw_events, current, baselines=baselines)
        return signals, errors
    except Exception as exc:
        errors.append(f"signal_engine: {exc}")
        logger.error("SignalEngine failed: %s", exc)
        return [], errors


def persist_signals(
    *,
    sheets: SheetsClient,
    signals: list[Signal],
    raw_events: list[Event],
) -> tuple[int, list[str]]:
    errors: list[str] = []
    stored = 0
    for signal in signals:
        try:
            sheets.append_signal(signal_to_sheet_dict(signal, raw_events))
            stored += 1
        except Exception as exc:
            errors.append(f"append_signal:{signal.signal_id}:{exc}")
            logger.error("Failed to store signal %s: %s", signal.signal_id, exc)
    return stored, errors

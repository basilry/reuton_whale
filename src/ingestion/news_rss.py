from __future__ import annotations

import hashlib
import html
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

import requests

from src.config import load_listener_config
from src.observability.service_health import append_service_heartbeat, pipeline_status_to_health
from src.pipeline.common import init_run_result
from src.storage.queries import now_iso
from src.storage.factory import build_storage_client
from src.utils.logger import get_logger

logger = get_logger("news_rss")

# Curated Top-20 crypto news RSS sources + 3 bonus mainstream finance feeds.
# Kept as a flat tuple so that config-free operation works out of the box.
# Future: make this list overridable via env (NEWS_RSS_FEEDS=name|url|lang,...)
# if an operator wants to disable a noisy source without a code change.
DEFAULT_FEEDS: tuple[tuple[str, str, str], ...] = (
    # --- Top 20 crypto-native ---
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/", "en"),
    ("Cointelegraph", "https://cointelegraph.com/rss", "en"),
    ("Decrypt", "https://decrypt.co/feed", "en"),
    ("The Block", "https://www.theblock.co/feed", "en"),
    ("CryptoSlate", "https://cryptoslate.com/feed/", "en"),
    ("CryptoPotato", "https://cryptopotato.com/feed/", "en"),
    ("Bitcoin Magazine", "https://bitcoinmagazine.com/feed", "en"),
    ("News.Bitcoin.com", "https://news.bitcoin.com/feed/", "en"),
    ("BeInCrypto", "https://beincrypto.com/feed/", "en"),
    ("CoinGape", "https://coingape.com/feed/", "en"),
    ("The Defiant", "https://thedefiant.io/feed/", "en"),
    ("AMBCrypto", "https://ambcrypto.com/feed/", "en"),
    ("U.Today", "https://u.today/rss", "en"),
    ("Daily Hodl", "https://dailyhodl.com/feed/", "en"),
    ("Crypto News", "https://cryptonews.com/news/feed/", "en"),
    ("Blockworks", "https://blockworks.co/feed", "en"),
    ("Bitcoinist", "https://bitcoinist.com/feed/", "en"),
    ("CCN", "https://www.ccn.com/feed/", "en"),
    ("CoinJournal", "https://coinjournal.net/feed/", "en"),
    ("Messari", "https://messari.io/rss", "en"),
    # --- Bonus: mainstream finance / macro ---
    ("Yahoo Finance", "https://finance.yahoo.com/news/rssindex", "en"),
    ("CNBC Crypto", "https://www.cnbc.com/id/10000664/device/rss/rss.html", "en"),
    ("TronWeekly", "https://www.tronweekly.com/feed", "en"),
)
# Per-feed entry cap. Lowered from 8 when the feed list grew from 3 → 23 to
# keep the churn on the news_feed sheet bounded (23 × 5 = 115 max per poll).
ENTRY_LIMIT_PER_FEED = 5
# (connect_timeout, read_timeout). Previously a single 20s value blocked the
# whole pipeline on one slow endpoint; pairing the two lets us fail fast on
# connection issues while still allowing slower sites to finish.
REQUEST_TIMEOUT_SECONDS: tuple[float, float] = (5.0, 12.0)
# Bounded concurrency so 23 feeds × worst-case timeout doesn't serialize into
# 4+ minutes. 6 workers means the slowest ~4 feeds can dominate while the rest
# complete in parallel. Tune up if the pipeline slot allows more.
MAX_FEED_WORKERS = 6
ATOM_NS = "{http://www.w3.org/2005/Atom}"


@dataclass(frozen=True)
class FeedFetchResult:
    source: str
    url: str
    language: str
    status: str
    items_fetched: int
    http_status: int | None = None
    error: str = ""
    etag: str = ""
    last_modified: str = ""


def _strip_html(value: str) -> str:
    cleaned = re.sub(r"<[^>]+>", " ", value or "")
    return html.unescape(re.sub(r"\s+", " ", cleaned)).strip()


def _truncate(value: str, max_length: int) -> str:
    if len(value) <= max_length:
        return value
    return f"{value[: max_length - 1].rstrip()}…"


def _normalize_timestamp(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""

    for parser in (
        lambda text: parsedate_to_datetime(text),
        lambda text: datetime.fromisoformat(text.replace("Z", "+00:00")),
    ):
        try:
            parsed = parser(raw)
        except (TypeError, ValueError):
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()

    return raw


def _node_text(node: ElementTree.Element, *paths: str) -> str:
    for path in paths:
        value = node.findtext(path)
        if value and value.strip():
            return value.strip()
    return ""


def _extract_link(node: ElementTree.Element) -> str:
    for path in ("link", f"{ATOM_NS}link"):
        link = node.find(path)
        if link is None:
            continue
        href = (link.get("href") or "").strip()
        if href:
            return href
        text = (link.text or "").strip()
        if text:
            return text
    return ""


def _extract_tags(node: ElementTree.Element) -> str:
    tags: list[str] = []
    for tag in node.findall("category") + node.findall(f"{ATOM_NS}category"):
        value = (tag.get("term") or tag.text or "").strip()
        if value and value not in tags:
            tags.append(value)
    return ",".join(tags[:4])


def _entry_id(source: str, url: str, title: str, published_at: str) -> tuple[str, str]:
    digest = hashlib.sha256(
        f"{source}|{url}|{title}|{published_at}".encode("utf-8")
    ).hexdigest()
    return digest[:16], digest


class NewsRssIngestor:
    def __init__(
        self,
        feeds: tuple[tuple[str, str, str], ...] = DEFAULT_FEEDS,
        per_feed_limit: int = ENTRY_LIMIT_PER_FEED,
    ) -> None:
        self._feeds = feeds
        self._per_feed_limit = per_feed_limit

    def fetch(self) -> tuple[list[dict], list[FeedFetchResult]]:
        """Fetch every configured feed in parallel, preserving feed order.

        Each feed is fetched in its own worker thread; exceptions are caught per
        feed so one slow or broken endpoint cannot stall the whole poll. Total
        wall time is bounded by ``MAX_FEED_WORKERS`` and the per-feed timeout.
        """
        rows: list[dict] = []
        # Pre-size results so we can preserve the configured feed order in the
        # output, which makes the system_log details easier to scan.
        results: list[FeedFetchResult | None] = [None] * len(self._feeds)
        fetched_at = now_iso()

        worker_count = max(1, min(MAX_FEED_WORKERS, len(self._feeds)))
        with ThreadPoolExecutor(
            max_workers=worker_count, thread_name_prefix="news_rss"
        ) as pool:
            future_to_index = {
                pool.submit(
                    self._fetch_feed_safe,
                    source,
                    url,
                    language,
                    fetched_at,
                ): index
                for index, (source, url, language) in enumerate(self._feeds)
            }
            for future in as_completed(future_to_index):
                index = future_to_index[future]
                feed_rows, feed_result = future.result()
                rows.extend(feed_rows)
                results[index] = feed_result

        # None entries would only happen on an internal bug (futures always
        # resolve via _fetch_feed_safe). Normalize defensively.
        ordered_results: list[FeedFetchResult] = [
            item
            for item in results
            if item is not None
        ]
        return rows, ordered_results

    def _fetch_feed_safe(
        self,
        source: str,
        url: str,
        language: str,
        fetched_at: str,
    ) -> tuple[list[dict], FeedFetchResult]:
        """Wrap _fetch_feed with per-feed exception handling for the thread pool."""
        try:
            return self._fetch_feed(source, url, language, fetched_at)
        except requests.RequestException as exc:
            logger.warning("RSS request failed source=%s: %s", source, exc)
            return [], FeedFetchResult(
                source=source,
                url=url,
                language=language,
                status="error",
                items_fetched=0,
                http_status=getattr(getattr(exc, "response", None), "status_code", None),
                error=str(exc),
            )
        except ElementTree.ParseError as exc:
            logger.warning("RSS parse failed source=%s: %s", source, exc)
            return [], FeedFetchResult(
                source=source,
                url=url,
                language=language,
                status="parse_error",
                items_fetched=0,
                error=str(exc),
            )
        except Exception as exc:  # defensive: keep one feed from stopping all
            logger.warning("Unexpected RSS failure source=%s: %s", source, exc)
            return [], FeedFetchResult(
                source=source,
                url=url,
                language=language,
                status="error",
                items_fetched=0,
                error=str(exc),
            )

    def _fetch_feed(
        self,
        source: str,
        url: str,
        language: str,
        fetched_at: str,
    ) -> tuple[list[dict], FeedFetchResult]:
        # Some RSS hosts (notably CDN-fronted ones) 403 the default
        # python-requests UA. A generic desktop UA avoids that without pretending
        # to be a full browser.
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (compatible; WhaleScopeBot/1.0; "
                "+https://whalescope.example/bot)"
            ),
            "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
        }
        response = requests.get(
            url,
            timeout=REQUEST_TIMEOUT_SECONDS,
            headers=headers,
        )
        response.raise_for_status()

        root = ElementTree.fromstring(response.content)
        entries = root.findall("./channel/item")
        if not entries:
            entries = root.findall(f".//{ATOM_NS}entry")

        rows: list[dict] = []
        for node in entries[: self._per_feed_limit]:
            title = _strip_html(_node_text(node, "title", f"{ATOM_NS}title"))
            if not title:
                continue

            summary = _strip_html(
                _node_text(
                    node,
                    "description",
                    "summary",
                    f"{ATOM_NS}summary",
                    "content",
                    f"{ATOM_NS}content",
                )
            )
            link = _extract_link(node)
            published_at = _normalize_timestamp(
                _node_text(
                    node,
                    "pubDate",
                    "published",
                    "updated",
                    f"{ATOM_NS}published",
                    f"{ATOM_NS}updated",
                )
            )
            entry_id, digest = _entry_id(source, link, title, published_at)

            rows.append(
                {
                    "id": entry_id,
                    "source": source,
                    "title": _truncate(title, 160),
                    "summary": _truncate(summary, 280),
                    "url": link,
                    "published_at": published_at,
                    "language": language,
                    "tags": _extract_tags(node),
                    "fetched_at": fetched_at,
                    "hash": digest,
                }
            )

        result = FeedFetchResult(
            source=source,
            url=url,
            language=language,
            status="ok",
            items_fetched=len(rows),
            http_status=response.status_code,
            etag=str(response.headers.get("ETag") or ""),
            last_modified=str(response.headers.get("Last-Modified") or ""),
        )
        logger.info("Fetched %d RSS rows from %s", len(rows), source)
        return rows, result


def run_news_rss_refresh() -> dict[str, object]:
    result = init_run_result("news_rss")
    load_listener_config()
    client = build_storage_client()
    ingestor = NewsRssIngestor()
    rows, feed_results = ingestor.fetch()
    inserted = client.append_news_feed(rows)
    feeds_ok = sum(1 for item in feed_results if item.status == "ok")
    feeds_failed = len(feed_results) - feeds_ok
    details_payload = {
        "items_fetched": len(rows),
        "items_new": inserted,
        "feeds_ok": feeds_ok,
        "feeds_failed": feeds_failed,
        "feed_results": [asdict(item) for item in feed_results],
    }
    result.update(
        status="completed" if feeds_failed == 0 else "completed_with_errors",
        finished_at=now_iso(),
        errors=json.dumps(
            [item.error for item in feed_results if item.error],
            ensure_ascii=False,
        ),
        details=json.dumps(details_payload, ensure_ascii=False),
        items_fetched=len(rows),
        items_new=inserted,
        feeds_ok=feeds_ok,
        feeds_failed=feeds_failed,
        feed_results=[asdict(item) for item in feed_results],
    )
    client.log_run(result)
    append_service_heartbeat(
        client,
        service="pipeline.news_rss",
        component="pipeline",
        status=pipeline_status_to_health(result.get("status")),
        heartbeat_key=str(result.get("run_id", "")),
        details={
            "status": result.get("status"),
            "details": result.get("details", ""),
        },
        error=result.get("errors", ""),
        job_name="news_rss",
        processed_count=inserted,
        source_name="rss_feeds",
    )
    logger.info(
        "Stored %d news_feed rows feeds_ok=%d feeds_failed=%d",
        inserted,
        feeds_ok,
        feeds_failed,
    )
    return result


def main() -> None:
    run_news_rss_refresh()


if __name__ == "__main__":
    main()

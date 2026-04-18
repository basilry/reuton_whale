from __future__ import annotations

import hashlib
import html
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

import requests

from src.config import load_listener_config
from src.storage.queries import now_iso
from src.storage.sheets_client import SheetsClient
from src.utils.logger import get_logger

logger = get_logger("news_rss")

DEFAULT_FEEDS: tuple[tuple[str, str, str], ...] = (
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/", "en"),
    ("Cointelegraph", "https://cointelegraph.com/rss", "en"),
    ("Decrypt", "https://decrypt.co/feed", "en"),
)
ENTRY_LIMIT_PER_FEED = 8
REQUEST_TIMEOUT_SECONDS = 20
ATOM_NS = "{http://www.w3.org/2005/Atom}"


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

    def fetch(self) -> list[dict]:
        rows: list[dict] = []
        fetched_at = now_iso()
        for source, url, language in self._feeds:
            try:
                rows.extend(self._fetch_feed(source, url, language, fetched_at))
            except requests.RequestException as exc:
                logger.warning("RSS request failed source=%s: %s", source, exc)
            except ElementTree.ParseError as exc:
                logger.warning("RSS parse failed source=%s: %s", source, exc)
            except Exception as exc:  # defensive: keep one feed from stopping all
                logger.warning("Unexpected RSS failure source=%s: %s", source, exc)
        return rows

    def _fetch_feed(
        self,
        source: str,
        url: str,
        language: str,
        fetched_at: str,
    ) -> list[dict]:
        response = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
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

        logger.info("Fetched %d RSS rows from %s", len(rows), source)
        return rows


def run_news_rss_refresh() -> dict[str, int]:
    config = load_listener_config()
    client = SheetsClient(config.sheet_id, config.google_credentials)
    ingestor = NewsRssIngestor()
    rows = ingestor.fetch()
    inserted = client.append_news_feed(rows)
    logger.info("Stored %d news_feed rows", inserted)
    return {"fetched": len(rows), "inserted": inserted}


def main() -> None:
    run_news_rss_refresh()


if __name__ == "__main__":
    main()

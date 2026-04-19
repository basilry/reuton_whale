from __future__ import annotations

from pathlib import Path

from scripts.import_watched_addresses import load_csv


def test_load_csv_ignores_leading_comment_lines(tmp_path: Path) -> None:
    csv_path = tmp_path / "watched_addresses.csv"
    csv_path.write_text(
        "\n".join(
            [
                "# chain enum: ETH, XRP, TRX, BTC, DOGE",
                "# feature flags: ENABLE_CHAIN_XRP, ENABLE_CHAIN_TRX, ENABLE_CHAIN_BTC, ENABLE_CHAIN_DOGE",
                "# partial view: BTC and DOGE may render a partial-view badge",
                "address,chain,category,label,source,confidence,enabled,added_at,notes",
                "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo,BTC,cex,Binance BTC Cold 1,public,high,true,2026-04-19,test row",
            ]
        ),
        encoding="utf-8",
    )

    rows = load_csv(csv_path)

    assert rows == [
        {
            "address": "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo",
            "chain": "BTC",
            "category": "cex",
            "label": "Binance BTC Cold 1",
            "source": "public",
            "confidence": "high",
            "enabled": "true",
            "added_at": "2026-04-19",
            "notes": "test row",
        }
    ]

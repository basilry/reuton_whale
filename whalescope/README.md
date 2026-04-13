# WhaleScope

AI-powered cryptocurrency whale transaction monitoring and daily briefing service. Collects on-chain whale movements, analyzes them with Claude AI, and delivers Korean-language briefings via Telegram.

## Architecture

```
[Data Collection]          [AI Analysis]           [Storage & Distribution]

Whale Alert API ----+      TransactionScorer       Google Sheets
  (on-chain data)   |        (pre-filter)            (transactions, briefs,
                    v            |                    watchlists, logs)
               Collector ---> pre_filter (>=1M)          |
                    |            |                       v
CoinGecko API ------+      ClaudeAnalyzer          Telegram Bot
  (market data)   Enricher   (analyze_batch)         (daily brief)
                    |            |                       |
                    v            v                       v
               Enriched TX --> Analyzed TX ---+---> Daily Brief
                                             |
                                     rank_by_importance
                                        (Top 5)
```

## Tech Stack

| Category | Technology | Purpose |
|----------|-----------|---------|
| Language | Python 3.12 | Core runtime |
| AI | Anthropic Claude API (claude-sonnet-4-20250514) | Transaction interpretation |
| Data Source | Whale Alert API | On-chain whale transaction feed |
| Market Data | CoinGecko API | Real-time price/volume enrichment |
| Storage | Google Sheets (gspread) | Persistent data store |
| Distribution | Telegram Bot API (python-telegram-bot) | User-facing briefing delivery |
| Dashboard | Streamlit | Web-based monitoring UI |
| CI/CD | GitHub Actions | Automated daily pipeline |
| Testing | pytest | Unit and integration tests |

## Modules

| Module | Description |
|--------|-------------|
| `src/collectors/` | Whale Alert API collector + CoinGecko market data enricher |
| `src/analyzer/` | Claude AI transaction analysis + importance scoring |
| `src/storage/` | Google Sheets persistence (transactions, briefs, watchlists, logs) |
| `src/distributor/` | Telegram bot with daily brief formatting |
| `src/utils/` | Logger, retry decorator, custom errors |
| `src/main.py` | Pipeline orchestrator (10-step daily pipeline) |
| `src/config.py` | Environment-based configuration loader |

## Setup

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Configure environment
cp .env.example .env
# Fill in all API keys in .env

# 3. Verify connections
python scripts/test_connection.py

# 4. Run a manual brief
python scripts/manual_brief.py
```

## Running

### Local (manual)
```bash
python scripts/manual_brief.py
```

### Streamlit Dashboard
```bash
streamlit run streamlit_app.py
```

### GitHub Actions (automated daily)
The `.github/workflows/daily_brief.yml` workflow runs `run_daily_pipeline()` on a cron schedule. Required secrets: `WHALE_ALERT_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_CREDENTIALS_JSON`, `TELEGRAM_BOT_TOKEN`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WHALE_ALERT_API_KEY` | Whale Alert API key |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `GOOGLE_SHEET_ID` | Target Google Spreadsheet ID |
| `GOOGLE_CREDENTIALS_JSON` | Google service account JSON (stringified) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |

## Tests

```bash
pytest tests/ -v
```

Coverage: collectors, analyzer (Claude + scoring), storage (schema + queries + SheetsClient), distributor (formatters + bot), pipeline integration. All external APIs are mocked.

## AI Tools Usage

| Tool | Usage |
|------|-------|
| **Claude API** (claude-sonnet-4-20250514) | Runtime: analyzes each whale transaction and generates Korean daily briefings. Structured JSON output with importance scoring, transaction type classification, and confidence levels. |
| **Claude Code** (claude-opus-4-6) | Development: full codebase scaffolding, module implementation, test writing, code review, and QA. |

## Future Plans

- Real-time WebSocket streaming (replace polling)
- Multi-chain coverage expansion (Solana, Polygon, Arbitrum)
- Historical pattern detection (repeat address tracking)
- Custom alert thresholds per user
- Supabase/PostgreSQL migration for scalable storage
- Token-level cost tracking and budget alerts

## License

Private - All rights reserved.

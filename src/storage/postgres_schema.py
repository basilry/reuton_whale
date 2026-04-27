"""Postgres DDL for WhaleScope storage.

The statements are intentionally idempotent so ``scripts.init_postgres`` can be
run repeatedly during deploys and Render one-off jobs.
"""
from __future__ import annotations

TABLE_NAMES = (
    "transactions",
    "address_activity",
    "system_log",
    "service_health",
    "signals",
    "daily_brief",
    "tg_whale_events",
    "broadcast_log",
    "brief_cost_ledger",
    "llm_budget_log",
    "channel_health",
    "news_feed",
    "curated_wallets",
    "wallet_detail_profiles",
    "curated_wallet_balances",
    "whale_stories",
    "analysis_log",
    "watched_addresses",
    "user_interests",
    "subscribers",
    "wallet_aliases",
    "watchlist_overrides",
)

CREATE_TABLE_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS transactions (
      id bigserial PRIMARY KEY,
      raw_response_hash text UNIQUE,
      hash text,
      timestamp timestamptz,
      blockchain text,
      symbol text,
      amount numeric,
      amount_usd numeric,
      from_address text,
      from_owner_type text,
      from_owner text,
      to_address text,
      to_owner_type text,
      to_owner text,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      seen_count integer NOT NULL DEFAULT 1
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS address_activity (
      id bigserial PRIMARY KEY,
      tx_hash text,
      chain text,
      block_time timestamptz,
      watched_address text,
      direction text,
      counterparty text,
      counterparty_category text,
      token text,
      amount_token numeric,
      amount_usd numeric,
      collected_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tx_hash, watched_address, direction)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS system_log (
      id bigserial PRIMARY KEY,
      run_id text,
      run_type text,
      status text,
      started_at timestamptz,
      finished_at timestamptz,
      transactions_count integer,
      errors text,
      details jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS service_health (
      id bigserial PRIMARY KEY,
      ts timestamptz NOT NULL DEFAULT now(),
      service text,
      component text,
      status text,
      heartbeat_key text,
      details jsonb,
      error text,
      instance_id text,
      job_name text,
      last_success_at timestamptz,
      last_failure_at timestamptz,
      processed_count integer,
      lag_seconds integer,
      duration_ms integer,
      source_name text,
      supported_chains text,
      unsupported_chain_count integer,
      unsupported_chain_names text,
      per_chain_event_count text
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS signals (
      id bigserial PRIMARY KEY,
      signal_id text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      rule text,
      severity text,
      score numeric,
      confidence text,
      source text,
      evidence_tx_hashes jsonb,
      window_start timestamptz,
      window_end timestamptz,
      summary text,
      extra_json jsonb
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS daily_brief (
      id bigserial PRIMARY KEY,
      date text,
      summary text,
      top_transactions jsonb,
      total_volume_usd numeric,
      alert_count integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      highlights text,
      signal_themes jsonb,
      note text,
      input_fingerprint text
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS tg_whale_events (
      id bigserial PRIMARY KEY,
      tg_msg_id text UNIQUE,
      tg_date timestamptz,
      blockchain text,
      symbol text,
      amount numeric,
      amount_usd numeric,
      from_owner_type text,
      from_owner text,
      to_owner_type text,
      to_owner text,
      raw_text text,
      parsed_confidence numeric,
      external_channel text,
      external_display_name text,
      external_confidence numeric,
      collected_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS broadcast_log (
      id bigserial PRIMARY KEY,
      ts timestamptz NOT NULL DEFAULT now(),
      kind text,
      dedup_key text,
      chat_id text,
      message_id text,
      status text,
      error text,
      message_length integer,
      content_hash text,
      signal_count integer,
      transaction_count integer,
      slot_key text,
      delivery_mode text,
      decision text,
      reason text,
      fallback_source text,
      candidate_signal_count integer,
      candidate_transaction_count integer,
      last_channel_delivery_at timestamptz,
      next_expected_at timestamptz
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS brief_cost_ledger (
      id bigserial PRIMARY KEY,
      ts timestamptz NOT NULL DEFAULT now(),
      slot_key text,
      decision text,
      llm_called boolean,
      model_id text,
      tokens_in integer,
      tokens_out integer,
      cost_usd numeric,
      cumulative_cost_usd numeric,
      signal_count integer,
      transaction_count integer,
      input_fingerprint text,
      reason text
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS llm_budget_log (
      id bigserial PRIMARY KEY,
      ts timestamptz NOT NULL DEFAULT now(),
      month_key text,
      pipeline text,
      model_id text,
      tokens_in integer,
      tokens_out integer,
      cost_usd numeric,
      cumulative_cost_usd numeric,
      decision text
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS channel_health (
      id bigserial PRIMARY KEY,
      ts timestamptz NOT NULL DEFAULT now(),
      chat_id text,
      title text,
      username text,
      member_count integer,
      status text,
      error text
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS news_feed (
      id text PRIMARY KEY,
      source text,
      title text,
      summary text,
      url text,
      published_at timestamptz,
      language text,
      tags text,
      fetched_at timestamptz NOT NULL DEFAULT now(),
      hash text UNIQUE,
      last_seen_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS curated_wallets (
      id text PRIMARY KEY,
      chain text,
      address text,
      owner_label text,
      owner_category text,
      owner_subcategory text,
      approx_balance numeric,
      tier text,
      source_ref text,
      source_url text,
      note text,
      entity_id text,
      is_representative text,
      narrative_tags text,
      display_priority integer,
      is_active text,
      created_at timestamptz,
      updated_at timestamptz
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS wallet_detail_profiles (
      wallet_id text PRIMARY KEY,
      entity_id text,
      address text,
      chain text,
      title text,
      thesis text,
      behavior_summary text,
      watch_reason text,
      risk_note text,
      data_status text,
      approx_balance_label text,
      tags jsonb,
      source text,
      source_ref text,
      source_url text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS curated_wallet_balances (
      wallet_id text PRIMARY KEY,
      chain text,
      address text,
      owner_label text,
      owner_category text,
      approx_balance numeric,
      source_ref text,
      source_url text,
      note text,
      is_active text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS whale_stories (
      id text PRIMARY KEY,
      signal_id text,
      wallet_id text,
      title text,
      body_ko text,
      body_en text,
      impact_score numeric,
      published_at timestamptz NOT NULL DEFAULT now(),
      source_signal_ts timestamptz
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS analysis_log (
      prompt_hash text PRIMARY KEY,
      task text,
      prompt_version text,
      prompt text,
      response text,
      model text,
      model_id text,
      tokens_used integer,
      tokens_in integer,
      tokens_out integer,
      cost_usd numeric,
      latency_ms integer,
      status text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS watched_addresses (
      address text PRIMARY KEY,
      chain text,
      category text,
      label text,
      source text,
      confidence numeric,
      enabled text,
      added_at timestamptz,
      notes text
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_interests (
      id bigserial PRIMARY KEY,
      chat_id text,
      dimension text,
      value text,
      weight numeric,
      source text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (chat_id, dimension, value)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS subscribers (
      chat_id text PRIMARY KEY,
      username text,
      status text,
      watchlist_coins text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      last_brief_at timestamptz,
      status_changed_at timestamptz,
      language text
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS wallet_aliases (
      canonical_id text,
      alias_id text,
      chain text,
      address text,
      label text,
      note text
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS watchlist_overrides (
      wallet_id text PRIMARY KEY,
      enabled text,
      actor text,
      reason text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
    """,
)

MIGRATION_STATEMENTS = (
    "ALTER TABLE IF EXISTS transactions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz",
    "ALTER TABLE IF EXISTS transactions ADD COLUMN IF NOT EXISTS seen_count integer",
    """
    UPDATE transactions
    SET last_seen_at = COALESCE(last_seen_at, created_at, timestamp, now())
    WHERE last_seen_at IS NULL
    """,
    """
    UPDATE transactions
    SET seen_count = COALESCE(seen_count, 1)
    WHERE seen_count IS NULL
    """,
    "ALTER TABLE IF EXISTS transactions ALTER COLUMN last_seen_at SET DEFAULT now()",
    "ALTER TABLE IF EXISTS transactions ALTER COLUMN seen_count SET DEFAULT 1",
    "ALTER TABLE IF EXISTS transactions ALTER COLUMN last_seen_at SET NOT NULL",
    "ALTER TABLE IF EXISTS transactions ALTER COLUMN seen_count SET NOT NULL",
    "ALTER TABLE IF EXISTS broadcast_log ADD COLUMN IF NOT EXISTS decision text",
    "ALTER TABLE IF EXISTS broadcast_log ADD COLUMN IF NOT EXISTS reason text",
    "ALTER TABLE IF EXISTS broadcast_log ADD COLUMN IF NOT EXISTS fallback_source text",
    "ALTER TABLE IF EXISTS broadcast_log ADD COLUMN IF NOT EXISTS candidate_signal_count integer",
    "ALTER TABLE IF EXISTS broadcast_log ADD COLUMN IF NOT EXISTS candidate_transaction_count integer",
    "ALTER TABLE IF EXISTS broadcast_log ADD COLUMN IF NOT EXISTS last_channel_delivery_at timestamptz",
    "ALTER TABLE IF EXISTS broadcast_log ADD COLUMN IF NOT EXISTS next_expected_at timestamptz",
    "ALTER TABLE IF EXISTS wallet_detail_profiles ADD COLUMN IF NOT EXISTS approx_balance_label text",
    "ALTER TABLE IF EXISTS wallet_detail_profiles ADD COLUMN IF NOT EXISTS source_ref text",
    "ALTER TABLE IF EXISTS wallet_detail_profiles ADD COLUMN IF NOT EXISTS source_url text",
)

CREATE_INDEX_STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_last_seen_at ON transactions (last_seen_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions (hash)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_chain_symbol ON transactions (blockchain, symbol)",
    "CREATE INDEX IF NOT EXISTS idx_address_activity_collected_at ON address_activity (collected_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_address_activity_tx_hash ON address_activity (tx_hash)",
    "CREATE INDEX IF NOT EXISTS idx_system_log_started_at ON system_log (started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_system_log_run_type ON system_log (run_type, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_service_health_ts ON service_health (ts DESC)",
    "CREATE INDEX IF NOT EXISTS idx_service_health_job_ts ON service_health (job_name, ts DESC)",
    "CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals (created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_signals_window_end ON signals (window_end DESC)",
    "CREATE INDEX IF NOT EXISTS idx_daily_brief_created_at ON daily_brief (created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_daily_brief_date ON daily_brief (date)",
    "CREATE INDEX IF NOT EXISTS idx_tg_whale_events_collected_at ON tg_whale_events (collected_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_tg_whale_events_tg_date ON tg_whale_events (tg_date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_broadcast_log_ts ON broadcast_log (ts DESC)",
    "CREATE INDEX IF NOT EXISTS idx_broadcast_log_kind_ts ON broadcast_log (kind, ts DESC)",
    "CREATE INDEX IF NOT EXISTS idx_brief_cost_ledger_ts ON brief_cost_ledger (ts DESC)",
    "CREATE INDEX IF NOT EXISTS idx_llm_budget_log_month_ts ON llm_budget_log (month_key, ts DESC)",
    "CREATE INDEX IF NOT EXISTS idx_channel_health_ts ON channel_health (ts DESC)",
    "CREATE INDEX IF NOT EXISTS idx_news_feed_last_seen_at ON news_feed (last_seen_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_curated_wallets_active_priority ON curated_wallets (is_active, display_priority)",
    "CREATE INDEX IF NOT EXISTS idx_wallet_detail_profiles_entity_id ON wallet_detail_profiles (entity_id)",
    "CREATE INDEX IF NOT EXISTS idx_wallet_detail_profiles_address ON wallet_detail_profiles (address)",
    "CREATE INDEX IF NOT EXISTS idx_wallet_detail_profiles_updated_at ON wallet_detail_profiles (updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_whale_stories_published_at ON whale_stories (published_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_user_interests_chat_id ON user_interests (chat_id)",
    "CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers (status)",
    "CREATE INDEX IF NOT EXISTS idx_wallet_aliases_canonical_id ON wallet_aliases (canonical_id)",
    "CREATE INDEX IF NOT EXISTS idx_watchlist_overrides_updated_at ON watchlist_overrides (updated_at DESC)",
)

SCHEMA_STATEMENTS = (*CREATE_TABLE_STATEMENTS, *MIGRATION_STATEMENTS, *CREATE_INDEX_STATEMENTS)


def iter_schema_statements() -> tuple[str, ...]:
    """Return schema statements in dependency-safe execution order."""
    return SCHEMA_STATEMENTS


def schema_summary() -> dict[str, object]:
    return {
        "tables": TABLE_NAMES,
        "table_count": len(CREATE_TABLE_STATEMENTS),
        "migration_count": len(MIGRATION_STATEMENTS),
        "index_count": len(CREATE_INDEX_STATEMENTS),
        "statement_count": len(SCHEMA_STATEMENTS),
    }

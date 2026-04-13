import json
import os
from datetime import date, datetime, timedelta

import gspread
import pandas as pd
import streamlit as st
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

from src.storage.schema import (
    DAILY_BRIEF_HEADERS,
    TAB_DAILY_BRIEF,
    TAB_TRANSACTIONS,
    TRANSACTIONS_HEADERS,
)

load_dotenv()

SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]


@st.cache_resource
def get_spreadsheet():
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON", "")
    sheet_id = os.environ.get("GOOGLE_SHEET_ID", "")
    if not creds_json or not sheet_id:
        return None
    creds = Credentials.from_service_account_info(json.loads(creds_json), scopes=SCOPES)
    gc = gspread.authorize(creds)
    return gc.open_by_key(sheet_id)


@st.cache_data(ttl=300)
def load_transactions() -> pd.DataFrame:
    ss = get_spreadsheet()
    if ss is None:
        return pd.DataFrame(columns=TRANSACTIONS_HEADERS)
    try:
        ws = ss.worksheet(TAB_TRANSACTIONS)
        rows = ws.get_all_values()
    except gspread.exceptions.WorksheetNotFound:
        return pd.DataFrame(columns=TRANSACTIONS_HEADERS)
    if len(rows) <= 1:
        return pd.DataFrame(columns=TRANSACTIONS_HEADERS)
    df = pd.DataFrame(rows[1:], columns=rows[0])
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0)
    df["amount_usd"] = pd.to_numeric(df["amount_usd"], errors="coerce").fillna(0)
    df["timestamp"] = pd.to_numeric(df["timestamp"], errors="coerce")
    df["datetime"] = pd.to_datetime(df["timestamp"], unit="s", errors="coerce")
    df["date"] = df["datetime"].dt.date
    return df


@st.cache_data(ttl=300)
def load_daily_briefs() -> pd.DataFrame:
    ss = get_spreadsheet()
    if ss is None:
        return pd.DataFrame(columns=DAILY_BRIEF_HEADERS)
    try:
        ws = ss.worksheet(TAB_DAILY_BRIEF)
        rows = ws.get_all_values()
    except gspread.exceptions.WorksheetNotFound:
        return pd.DataFrame(columns=DAILY_BRIEF_HEADERS)
    if len(rows) <= 1:
        return pd.DataFrame(columns=DAILY_BRIEF_HEADERS)
    df = pd.DataFrame(rows[1:], columns=rows[0])
    df["total_volume_usd"] = pd.to_numeric(df["total_volume_usd"], errors="coerce").fillna(0)
    df["alert_count"] = pd.to_numeric(df["alert_count"], errors="coerce").fillna(0)
    return df


# --- Page config ---
st.set_page_config(page_title="WhaleScope", page_icon="🐋", layout="wide")
st.title("🐋 WhaleScope Dashboard")

# --- Load data ---
tx_df = load_transactions()
brief_df = load_daily_briefs()

# --- Sidebar filters ---
st.sidebar.header("Filters")

today = date.today()
default_start = today - timedelta(days=7)
date_range = st.sidebar.date_input(
    "Date range",
    value=(default_start, today),
    max_value=today,
)
if isinstance(date_range, tuple) and len(date_range) == 2:
    start_date, end_date = date_range
else:
    start_date, end_date = default_start, today

available_tokens = sorted(tx_df["symbol"].unique().tolist()) if not tx_df.empty else []
selected_tokens = st.sidebar.multiselect("Tokens", available_tokens, default=available_tokens)

min_importance = st.sidebar.slider("Min importance score", 1, 10, 1)

# --- Apply filters to transactions ---
filtered_tx = tx_df.copy()
if not filtered_tx.empty:
    filtered_tx = filtered_tx[
        (filtered_tx["date"] >= start_date)
        & (filtered_tx["date"] <= end_date)
    ]
    if selected_tokens:
        filtered_tx = filtered_tx[filtered_tx["symbol"].isin(selected_tokens)]

# --- Tabs ---
tab_brief, tab_history, tab_stats = st.tabs(["오늘의 브리핑", "거래 히스토리", "통계"])

# === Tab 1: 오늘의 브리핑 ===
with tab_brief:
    latest_date = brief_df["date"].max() if not brief_df.empty else None
    if latest_date:
        latest_briefs = brief_df[brief_df["date"] == latest_date]
        st.subheader(f"Daily Brief - {latest_date}")

        col1, col2 = st.columns(2)
        total_vol = latest_briefs["total_volume_usd"].sum()
        total_alerts = int(latest_briefs["alert_count"].sum())
        col1.metric("Total Volume (USD)", f"${total_vol:,.0f}")
        col2.metric("Alert Count", total_alerts)

        for _, row in latest_briefs.iterrows():
            with st.container():
                st.markdown(f"**{row['summary']}**" if row.get("summary") else "_No summary_")
                if row.get("top_transactions"):
                    try:
                        top_txs = json.loads(row["top_transactions"])
                        if isinstance(top_txs, list):
                            for tx in top_txs:
                                if isinstance(tx, dict):
                                    symbol = tx.get("symbol", "?")
                                    amt_usd = tx.get("amount_usd", 0)
                                    score = tx.get("importance_score", "-")
                                    interp = tx.get("interpretation", "")
                                    st.markdown(
                                        f"- **{symbol}** ${float(amt_usd):,.0f} "
                                        f"(score: {score}) - {interp}"
                                    )
                    except (json.JSONDecodeError, TypeError):
                        st.text(str(row["top_transactions"]))
                st.divider()
    else:
        st.info("No daily briefs available yet.")

    # Show recent transactions for today
    today_tx = filtered_tx[filtered_tx["date"] == today] if not filtered_tx.empty else pd.DataFrame()
    if not today_tx.empty:
        st.subheader("Today's transactions")
        for _, tx in today_tx.head(10).iterrows():
            st.markdown(
                f"🐋 **{tx['symbol']}** {tx['amount']:,.2f} "
                f"(${tx['amount_usd']:,.0f}) "
                f"| {tx['from_owner'] or tx['from_address'][:8]} → "
                f"{tx['to_owner'] or tx['to_address'][:8]} "
                f"| {tx['blockchain']}"
            )

# === Tab 2: 거래 히스토리 ===
with tab_history:
    st.subheader("Transaction History")
    if filtered_tx.empty:
        st.info("No transactions found for the selected filters.")
    else:
        display_cols = [
            "datetime", "symbol", "amount", "amount_usd",
            "from_owner", "to_owner", "blockchain",
        ]
        existing_cols = [c for c in display_cols if c in filtered_tx.columns]
        st.dataframe(
            filtered_tx[existing_cols].sort_values("datetime", ascending=False),
            use_container_width=True,
            hide_index=True,
        )
        st.caption(f"{len(filtered_tx)} transactions")

# === Tab 3: 통계 ===
with tab_stats:
    st.subheader("Statistics")
    if filtered_tx.empty:
        st.info("No data available for statistics.")
    else:
        # Daily transaction count
        st.markdown("#### Daily Transaction Count")
        daily_counts = filtered_tx.groupby("date").size().reset_index(name="count")
        daily_counts["date"] = pd.to_datetime(daily_counts["date"])
        st.line_chart(daily_counts.set_index("date")["count"])

        # Volume by token
        st.markdown("#### Volume by Token (USD)")
        token_vol = (
            filtered_tx.groupby("symbol")["amount_usd"]
            .sum()
            .sort_values(ascending=False)
        )
        st.bar_chart(token_vol)

        # Exchange deposit/withdrawal ratio
        st.markdown("#### Exchange Flow")
        exchange_tx = filtered_tx[
            (filtered_tx["from_owner_type"] == "exchange")
            | (filtered_tx["to_owner_type"] == "exchange")
        ]
        if not exchange_tx.empty:
            deposits = exchange_tx[exchange_tx["to_owner_type"] == "exchange"]["amount_usd"].sum()
            withdrawals = exchange_tx[exchange_tx["from_owner_type"] == "exchange"]["amount_usd"].sum()
            col1, col2, col3 = st.columns(3)
            col1.metric("Exchange Deposits", f"${deposits:,.0f}")
            col2.metric("Exchange Withdrawals", f"${withdrawals:,.0f}")
            net = deposits - withdrawals
            col3.metric("Net Flow", f"${net:,.0f}", delta=f"${net:,.0f}")
        else:
            st.info("No exchange transactions in selected range.")

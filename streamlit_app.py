import json
import os
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import gspread
import pandas as pd
import streamlit as st
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

from src.storage.schema import (
    DAILY_BRIEF_HEADERS,
    TAB_DAILY_BRIEF,
    TAB_SIGNALS,
    TAB_TRANSACTIONS,
    SIGNALS_HEADERS,
    TRANSACTIONS_HEADERS,
)

load_dotenv()

SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]
PROJECT_ROOT = Path(__file__).resolve().parent
PIPELINE_TIMEOUT_SECONDS = int(os.getenv("PIPELINE_TIMEOUT_SECONDS", "300"))


def _tail_text(text: str | bytes, limit: int = 4000) -> str:
    if isinstance(text, bytes):
        text = text.decode("utf-8", "replace")
    if len(text) <= limit:
        return text
    return "... truncated ...\n" + text[-limit:]


def _warn_sheets_error(action: str, exc: Exception) -> None:
    detail = str(exc).replace("\n", " ")[:240]
    st.warning(f"Google Sheets {action} 실패: {type(exc).__name__}: {detail}")


def _sheet_rows_to_frame(
    rows: list[list[str]],
    *,
    fallback_headers: list[str],
) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=fallback_headers)

    headers = list(rows[0]) if rows[0] else list(fallback_headers)
    target_len = len(headers)
    normalized_rows: list[list[str]] = []
    for row in rows[1:]:
        values = list(row[:target_len])
        if len(values) < target_len:
            values.extend([""] * (target_len - len(values)))
        normalized_rows.append(values)
    return pd.DataFrame(normalized_rows, columns=headers)


def _check_password() -> None:
    expected = os.getenv("STREAMLIT_PASSWORD", "")
    if not expected:
        st.warning("STREAMLIT_PASSWORD가 설정되지 않아 인증이 비활성화되었습니다.")
        return
    if st.session_state.get("authenticated"):
        return
    pw = st.text_input("비밀번호", type="password")
    if pw and pw == expected:
        st.session_state["authenticated"] = True
        st.rerun()
    if pw:
        st.error("비밀번호가 올바르지 않습니다.")
    st.stop()


@st.cache_resource
def get_spreadsheet():
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON", "")
    sheet_id = os.environ.get("GOOGLE_SHEET_ID", "")
    if not creds_json or not sheet_id:
        return None
    try:
        creds = Credentials.from_service_account_info(json.loads(creds_json), scopes=SCOPES)
        gc = gspread.authorize(creds)
        return gc.open_by_key(sheet_id)
    except Exception as exc:
        _warn_sheets_error("연결", exc)
        return None


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
    except Exception as exc:
        _warn_sheets_error("transactions 읽기", exc)
        return pd.DataFrame(columns=TRANSACTIONS_HEADERS)
    if len(rows) <= 1:
        return pd.DataFrame(columns=TRANSACTIONS_HEADERS)
    df = _sheet_rows_to_frame(rows, fallback_headers=TRANSACTIONS_HEADERS)
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
    except Exception as exc:
        _warn_sheets_error("daily_brief 읽기", exc)
        return pd.DataFrame(columns=DAILY_BRIEF_HEADERS)
    if len(rows) <= 1:
        return pd.DataFrame(columns=DAILY_BRIEF_HEADERS)
    df = _sheet_rows_to_frame(rows, fallback_headers=DAILY_BRIEF_HEADERS)
    df["total_volume_usd"] = pd.to_numeric(df["total_volume_usd"], errors="coerce").fillna(0)
    df["alert_count"] = pd.to_numeric(df["alert_count"], errors="coerce").fillna(0)
    return df


@st.cache_data(ttl=300)
def load_signals() -> pd.DataFrame:
    ss = get_spreadsheet()
    if ss is None:
        return pd.DataFrame(columns=SIGNALS_HEADERS)
    try:
        ws = ss.worksheet(TAB_SIGNALS)
        rows = ws.get_all_values()
    except gspread.exceptions.WorksheetNotFound:
        return pd.DataFrame(columns=SIGNALS_HEADERS)
    except Exception as exc:
        _warn_sheets_error("signals 읽기", exc)
        return pd.DataFrame(columns=SIGNALS_HEADERS)
    if len(rows) <= 1:
        return pd.DataFrame(columns=SIGNALS_HEADERS)
    df = _sheet_rows_to_frame(rows, fallback_headers=SIGNALS_HEADERS)
    df["score"] = pd.to_numeric(df["score"], errors="coerce").fillna(0)
    df["confidence"] = pd.to_numeric(df["confidence"], errors="coerce").fillna(0)
    df["created_at"] = pd.to_datetime(df["created_at"], errors="coerce")
    df["window_start"] = pd.to_datetime(df["window_start"], errors="coerce")
    df["window_end"] = pd.to_datetime(df["window_end"], errors="coerce")
    return df


def format_top_transaction_usd(tx: dict) -> str:
    if tx.get("amount_usd_known") is False or tx.get("amount_usd") in (None, ""):
        return "USD unknown"
    try:
        return f"${float(tx.get('amount_usd', 0)):,.0f}"
    except (TypeError, ValueError):
        return "USD unknown"


def run_daily_pipeline(timeout_seconds: int = PIPELINE_TIMEOUT_SECONDS) -> dict:
    started = time.monotonic()
    try:
        completed = subprocess.run(
            [sys.executable, "-m", "src.main"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
            env=os.environ.copy(),
        )
        elapsed = time.monotonic() - started
        return {
            "ok": completed.returncode == 0,
            "timed_out": False,
            "returncode": completed.returncode,
            "elapsed_seconds": elapsed,
            "stdout": _tail_text(completed.stdout or ""),
            "stderr": _tail_text(completed.stderr or ""),
        }
    except subprocess.TimeoutExpired as exc:
        elapsed = time.monotonic() - started
        return {
            "ok": False,
            "timed_out": True,
            "returncode": None,
            "elapsed_seconds": elapsed,
            "stdout": _tail_text(exc.stdout or ""),
            "stderr": _tail_text(exc.stderr or ""),
        }


def render_pipeline_controls() -> None:
    with st.sidebar.expander("운영 액션", expanded=False):
        st.caption("Google Sheets 저장과 Telegram 발송이 실제로 실행됩니다.")
        if st.button("일일 파이프라인 실행", type="primary"):
            with st.spinner("python -m src.main 실행 중..."):
                result = run_daily_pipeline()

            elapsed = result["elapsed_seconds"]
            if result["ok"]:
                load_transactions.clear()
                load_daily_briefs.clear()
                load_signals.clear()
                st.success(f"파이프라인 완료 ({elapsed:.1f}s)")
                st.info("데이터가 생성되었다면 페이지를 새로고침하면 대시보드에 반영됩니다.")
            elif result["timed_out"]:
                st.error(f"파이프라인이 {PIPELINE_TIMEOUT_SECONDS}s 안에 끝나지 않아 중단되었습니다.")
            else:
                st.error(f"파이프라인 실패 (exit={result['returncode']}, {elapsed:.1f}s)")

            with st.expander("실행 로그", expanded=not result["ok"]):
                if result["stdout"]:
                    st.code(result["stdout"], language="text")
                if result["stderr"]:
                    st.code(result["stderr"], language="text")


def main() -> None:
    st.set_page_config(page_title="WhaleScope", page_icon="🐋", layout="wide")
    _check_password()

    st.title("🐋 WhaleScope Dashboard")

    # --- Load data ---
    tx_df = load_transactions()
    brief_df = load_daily_briefs()
    signals_df = load_signals()

    # --- Sidebar filters ---
    st.sidebar.header("Filters")
    render_pipeline_controls()

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

    st.sidebar.slider("Min importance score", 1, 10, 1)

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
    tab_brief, tab_history, tab_signals, tab_stats = st.tabs(
        ["오늘의 브리핑", "거래 히스토리", "시그널", "통계"]
    )

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
                                        score = tx.get("importance_score", "-")
                                        interp = tx.get("interpretation", "")
                                        st.markdown(
                                            f"- **{symbol}** {format_top_transaction_usd(tx)} "
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

    # === Tab 3: 시그널 ===
    with tab_signals:
        st.subheader("Signal Dashboard")
        if signals_df.empty:
            st.info("아직 저장된 시그널이 없습니다. `python -m src.main` 실행 후 다시 확인하세요.")
        else:
            display_cols = ["created_at", "rule", "severity", "score", "source", "summary"]
            existing_cols = [c for c in display_cols if c in signals_df.columns]
            signal_view = signals_df.copy()
            if "created_at" in signal_view.columns:
                signal_view = signal_view.sort_values("created_at", ascending=False)
            st.dataframe(
                signal_view[existing_cols],
                use_container_width=True,
                hide_index=True,
            )
            st.caption(f"{len(signal_view)} signals")

    # === Tab 4: 통계 ===
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


if __name__ == "__main__":
    main()

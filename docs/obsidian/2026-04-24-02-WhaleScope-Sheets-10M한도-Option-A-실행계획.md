---
type: execution-plan
date: 2026-04-24
seq: "02"
status: ready-for-claude-code
tags:
  - WhaleScope
  - incident-recovery
  - google-sheets
  - gspread
  - storage
  - retention
  - claude-code-ticket
related:
  - 2026-04-24-01-WhaleScope-Sheets-10M셀한도-진단리포트.md
  - 2026-04-17-05-WhaleScope-잔여개선-실행계획.md
assignee: claude-code
author: cowork-claude
---

# WhaleScope 운영 장애 복구 — Option A 실행 계획 (Claude Code 티켓)

## 0. 요약

진단 리포트 `2026-04-24-01` 의 **Option A (코드 변경 없이 워크북을 10M 셀 이하로 복구)** 를 평행 Claude Code 세션이 그대로 집어 순차 실행할 수 있도록 정리한 티켓. 목표는 **크론 재가동까지 1시간 이내**, 그리고 **데이터 유실 0건 (삭제 전 CSV 백업)**.

> **중요 원칙**: 본 티켓은 destructive 작업(`ws.delete_rows`, `ws.resize`)을 포함한다. **Step 2 백업 완료 전 Step 3 를 절대 실행하지 않는다.** 각 destructive 스크립트는 `--dry-run` 을 기본값으로 두고, 사용자가 콘솔에서 `CONFIRM` 문자열을 입력해야 실제 삭제가 실행되도록 게이트한다.

## 1. 사전 조건

### 1.1 환경

| 항목 | 필요 값 | 확인 방법 |
|---|---|---|
| `GOOGLE_SHEET_ID` | 프로덕션 워크북 ID | `grep GOOGLE_SHEET_ID .env` |
| `GOOGLE_CREDENTIALS_JSON` | 서비스 계정 JSON 문자열 | `.env` 동일 |
| 서비스 계정 권한 | 해당 워크북에 Editor | Google Sheets 공유 설정 |
| Python | 3.11+ + `requirements.txt` 설치 | `python -c "import gspread; print(gspread.__version__)"` |
| gspread 버전 | 6.x (`delete_rows` API 사용) | 위와 동일 |

### 1.2 운영 상태

- **Render.com 크론 일시 중지 필수.** 퍼지 중에도 크론이 계속 append 를 시도하면 락 경합 + quota 낭비 + 새 데이터가 cutoff 경계를 밟음. Dashboard → Cron Job → `Suspend` 클릭. Step 4 성공 확인 후 `Resume`.
- Telegram 알림 봇(listener) 은 쓰기 빈도가 낮고 Redis 로 L2 캐싱되므로 중단할 필요 없으나, 혹시라도 영향을 주는지 모니터링만.

### 1.3 브랜치 / 워크트리

`2026-04-17-05` 에서 확립한 worktree 패턴을 재사용한다. 본 작업은 코드 변경 없이 **신규 스크립트만 추가** 하므로 단일 브랜치로 충분.

```bash
cd /Users/basilry/02015_reuton_whale  # 실제 경로에 맞춰
git worktree add ../wt-whale-recovery-sheets-10m -b recovery/sheets-10m-option-a
cd ../wt-whale-recovery-sheets-10m
```

### 1.4 선행 읽기

Claude Code 는 아래 3개 파일을 **반드시** 먼저 읽는다:

1. `docs/obsidian/2026-04-24-01-WhaleScope-Sheets-10M셀한도-진단리포트.md` — 원인·옵션 A~D 배경
2. `src/storage/schema.py` — 20개 TAB_HEADERS 정의 (cutoff 규칙을 위한 timestamp 컬럼명 확정)
3. `src/storage/sheets_client.py` 120–200 줄 — SheetsClient 초기화 + `_ensure_worksheets` 의 `rows=1000, cols=N` 패턴

## 2. 삭제·보존 규칙 (고정)

진단 리포트에서 합의된 값. 스크립트 상수로 박제한다.

| 탭 | timestamp 컬럼 | cutoff (일) | 이유 |
|---|---|---:|---|
| `service_health` | `ts` | 14 | 운영 추적용, 2주 이상은 대시보드/심사위원 가치 낮음 |
| `system_log` | `started_at` | 14 | 크론 실행 내역, 중복도 높음 |
| `tg_whale_events` | `collected_at` | 30 | 외부 채널 원본, 한 달이면 최근성 충분 |
| `broadcast_log` | `ts` | 30 | 감사 로그이지만 월 단위 유지 OK |
| `market_snapshots` | `ts` | 14 | 5분 주기, 2주 = 4,000 행 유지 |
| `address_activity` | `collected_at` | 60 | 알림 판단의 reference, 조금 더 보수적 |
| `analysis_log` | `created_at` | 60 | LLM 비용 감사, 2개월이면 월간 리뷰 가능 |
| `transactions` | `created_at`(fallback `timestamp`) | 90 | 가장 히스토리 가치 큰 데이터, 가장 넉넉히 보존 |

**절대 건드리지 않는 탭** (심사위원 데모 영향 / 설정 / 핵심 산출물):

- `subscribers`, `curated_wallets`, `watched_addresses`, `wallet_aliases`, `watchlist_overrides`, `curated_wallet_balances`, `user_interests`, `news_feed` (last_seen_at 갱신 기반 dedup), `daily_brief`, `whale_stories`, `signals`, `weekly_trend`, `wallet_activity_snapshots`, `brief_cost_ledger`, `llm_budget_log`, `channel_health`

보존 대상이지만 용량이 작아 퍼지 대상에서 제외. 만약 Step 1 조사 결과 예상과 다른 탭이 대용량으로 나오면 본 표를 갱신하고 사용자 재컨펌.

## 3. 스텝별 실행 계획

### Step 1 — 현황 조사 (read-only, 리스크 0)

**산출물**: `scripts/diagnose_sheets_cells.py` + `docs/obsidian/attachments/2026-04-24-sheets-cell-inventory.md` (표 형태 리포트)

**역할**: 각 워크시트의 `row_count × col_count` 와 실제 데이터 행 수를 조회해서 "어느 탭이 얼마나 셀을 먹고 있는가" 를 수치로 확정. 퍼지 예상 결과를 사전 시뮬레이션한다.

**스크립트 골격**:

```python
# scripts/diagnose_sheets_cells.py
"""Read-only 워크북 셀 인벤토리. 쓰기 없음, 안전.

사용법:
    python -m scripts.diagnose_sheets_cells
    python -m scripts.diagnose_sheets_cells --json > /tmp/inv.json
"""
from __future__ import annotations
import argparse, json, os
from datetime import datetime, timezone
from dotenv import load_dotenv

import gspread
from google.oauth2.service_account import Credentials

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    sheet_id = os.environ["GOOGLE_SHEET_ID"]
    creds = Credentials.from_service_account_info(
        json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"]),
        scopes=SCOPES,
    )
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(sheet_id)

    inventory = []
    total_grid_cells = 0
    for ws in sh.worksheets():
        rc, cc = ws.row_count, ws.col_count
        grid = rc * cc
        total_grid_cells += grid
        # 실제 비어있지 않은 row 수 — row 1 헤더 포함
        values = ws.get_all_values()
        data_rows = max(0, len(values) - 1)
        inventory.append({
            "tab": ws.title,
            "row_count": rc,
            "col_count": cc,
            "grid_cells": grid,
            "data_rows": data_rows,
            "empty_rows": max(0, rc - len(values)),
        })

    inventory.sort(key=lambda e: -e["grid_cells"])
    if args.json:
        print(json.dumps({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_grid_cells": total_grid_cells,
            "limit": 10_000_000,
            "headroom": 10_000_000 - total_grid_cells,
            "tabs": inventory,
        }, indent=2))
    else:
        print(f"Total grid cells: {total_grid_cells:,} / 10,000,000 "
              f"({total_grid_cells / 10_000_000:.1%})")
        print(f"Headroom: {10_000_000 - total_grid_cells:,}")
        print()
        print(f"{'TAB':<30} {'ROWS':>10} {'COLS':>5} {'GRID':>12} {'DATA':>10} {'EMPTY':>10}")
        for e in inventory:
            print(f"{e['tab']:<30} {e['row_count']:>10} {e['col_count']:>5} "
                  f"{e['grid_cells']:>12,} {e['data_rows']:>10,} {e['empty_rows']:>10,}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

**실행 + 검증**:

```bash
python -m scripts.diagnose_sheets_cells
python -m scripts.diagnose_sheets_cells --json > docs/obsidian/attachments/2026-04-24-sheets-cell-inventory.json
```

**성공 조건**:
- `Total grid cells` 값이 출력되고 10M 에 근접/초과하는 것을 육안 확인.
- Top 3 탭이 진단 리포트 §2.2 의 추정과 일치 (service_health / tg_whale_events / broadcast_log / system_log 등).

**실패 시**:
- 인증 실패 → `.env` 의 `GOOGLE_CREDENTIALS_JSON` 가 JSON 문자열인지, `GOOGLE_SHEET_ID` 가 맞는지 확인.
- `get_all_values` 가 quota 에러 → 이미 gspread write 쪽이 막혔지만 read 는 살아있을 것. 일시 429 면 30초 대기 후 재시도.

**Human-in-the-loop**: 조사 결과를 사용자에게 보고하고 cutoff 규칙(§2)이 타당한지 컨펌 받은 뒤 Step 2 진행.

---

### Step 2 — CSV 백업 (리스크 0, destructive 전 필수)

**산출물**: `scripts/backup_sheets_snapshot.py` + `backups/sheets/<UTC-ISO>/<tab>.csv` (gitignore 대상)

**역할**: Step 3 퍼지에서 삭제될 행을 포함한 **전체 워크시트를 CSV 로 덤프**. 삭제 이후 언제든 복구 가능한 상태 확보.

**설계**:
- 퍼지 대상 8개 탭 + 보존 탭 전체를 대상으로 **전수 백업** (용량 작고, 퍼지 대상만 뜨면 이후 분쟁 소지).
- 출력 경로: `backups/sheets/{YYYYMMDD-HHMMSS-UTC}/{tab}.csv`.
- CSV 라이브러리는 표준 `csv`. 이스케이프는 `QUOTE_MINIMAL` + `quotechar='"'`.
- 백업 검증: 파일 크기 0 이면 실패로 처리, 로그 남기고 즉시 abort.

**스크립트 골격**:

```python
# scripts/backup_sheets_snapshot.py
from __future__ import annotations
import csv, json, os
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
import gspread
from google.oauth2.service_account import Credentials

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
REPO_ROOT = Path(__file__).resolve().parents[1]

def main() -> int:
    load_dotenv()
    sheet_id = os.environ["GOOGLE_SHEET_ID"]
    creds = Credentials.from_service_account_info(
        json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"]),
        scopes=SCOPES,
    )
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(sheet_id)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_dir = REPO_ROOT / "backups" / "sheets" / stamp
    backup_dir.mkdir(parents=True, exist_ok=True)

    manifest = {"generated_at": stamp, "sheet_id": sheet_id, "tabs": []}
    for ws in sh.worksheets():
        rows = ws.get_all_values()
        path = backup_dir / f"{ws.title}.csv"
        with path.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
            for row in rows:
                w.writerow(row)
        size = path.stat().st_size
        if size == 0 and len(rows) > 1:
            raise RuntimeError(f"Empty backup for {ws.title} despite {len(rows)} rows")
        manifest["tabs"].append({
            "tab": ws.title,
            "rows": len(rows),
            "bytes": size,
            "path": str(path.relative_to(REPO_ROOT)),
        })
        print(f"[backup] {ws.title}: {len(rows)} rows, {size:,} bytes")

    (backup_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    print(f"\nBackup complete: {backup_dir}")
    print(f"Total tabs: {len(manifest['tabs'])}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

**추가 작업**:
- `.gitignore` 에 `backups/` 추가 (시트 원본 데이터가 커밋되지 않도록).
- 백업 경로와 `manifest.json` path 를 Step 3 스크립트에 입력으로 전달.

**성공 조건**:
- 20개 CSV 파일 + manifest.json 생성.
- 각 탭의 `rows` 값이 Step 1 인벤토리의 `data_rows + 1` (헤더 포함) 과 일치.

**실패 시**:
- 네트워크/quota 에러 → 30-60초 대기 후 재실행. gspread 는 idempotent.
- 디스크 공간 부족 → 백업 디렉토리 다른 경로 지정 (환경변수 `WHALESCOPE_BACKUP_DIR`).

**Human-in-the-loop**: 백업 디렉토리 크기(`du -sh backups/sheets/<stamp>`) 와 manifest 일치 여부를 사용자가 눈으로 확인. 통과 후 Step 3 진행 허락.

---

### Step 3 — 퍼지 + 그리드 축소 (destructive, 최대 주의)

**산출물**: `scripts/purge_sheets_once.py` + 실행 로그 `docs/obsidian/attachments/2026-04-24-sheets-purge-log.md`

**역할**: §2 고정 규칙에 따라 8개 탭에서 cutoff 이전 행 삭제 + 각 워크시트를 `(남은 데이터 행 + 헤더 + 여유 200행) × cols` 로 resize.

**설계 원칙**:
1. **dry-run 기본값**. `--apply` 플래그가 있고, 콘솔에 `I UNDERSTAND THIS DELETES ROWS` 문자열을 사용자가 직접 타이핑해야 실제 삭제 실행.
2. **탭별 순차 처리**. 병렬 처리하지 않음 (quota 보호 + 실패 시 추적 용이).
3. **배치 삭제**. `ws.delete_rows(start, end)` 를 한 번에 최대 5000행씩. 더 큰 범위는 gspread 가 quota 초과 가능.
4. **각 탭마다 3단계**:
   - (a) 전체 read → timestamp 컬럼 파싱 → cutoff 이전 row 인덱스 수집
   - (b) 연속 구간별로 `delete_rows(start, end)` 반복 (뒤에서부터 삭제해야 인덱스 시프트 영향 없음 → **내림차순**)
   - (c) 삭제 후 실제 잔존 row count 재조회 → `ws.resize(rows=data_rows + 1 + 200, cols=<기존 cols 유지>)`
5. **Step 2 백업 manifest 경로를 반드시 인자로 받고**, manifest 의 row 수와 현재 row 수가 일치하지 않으면 abort (백업 이후 다른 쓰기가 들어왔다는 신호).
6. **Redis flush 금지**. Redis L2 캐시는 별개 리소스로 이번 작업과 무관.
7. **timestamp 파싱 실패 행은 보존**. cutoff 비교 불가능한 행은 의도적으로 삭제하지 않음. 로그에 "skipped_unparseable" 카운트 남김.

**스크립트 골격**:

```python
# scripts/purge_sheets_once.py
from __future__ import annotations
import argparse, json, os, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from dotenv import load_dotenv
import gspread
from google.oauth2.service_account import Credentials

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

RETENTION_RULES = [
    # (tab, timestamp_col, cutoff_days)
    ("service_health",   "ts",           14),
    ("system_log",       "started_at",   14),
    ("tg_whale_events",  "collected_at", 30),
    ("broadcast_log",    "ts",           30),
    ("market_snapshots", "ts",           14),
    ("address_activity", "collected_at", 60),
    ("analysis_log",     "created_at",   60),
    ("transactions",     "created_at",   90),  # fallback: timestamp
]

DELETE_BATCH_MAX = 5000  # gspread 한 번 delete_rows 상한 가이드
RESIZE_BUFFER = 200      # 데이터 행 + 헤더 + 여유

def parse_ts(raw: str):
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        if raw.isdigit():
            return datetime.fromtimestamp(int(raw), tz=timezone.utc)
        ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None

def collapse_runs(sorted_indices: list[int]) -> list[tuple[int, int]]:
    """연속된 row index 를 (start, end) 튜플 묶음으로 변환."""
    if not sorted_indices:
        return []
    runs = []
    start = prev = sorted_indices[0]
    for idx in sorted_indices[1:]:
        if idx == prev + 1:
            prev = idx
        else:
            runs.append((start, prev))
            start = prev = idx
    runs.append((start, prev))
    return runs

def purge_tab(ws, ts_col: str, cutoff: datetime, *, apply: bool) -> dict:
    values = ws.get_all_values()
    if not values:
        return {"tab": ws.title, "skipped": "empty"}
    header = values[0]
    if ts_col not in header:
        # fallback 처리 (transactions 의 timestamp 등)
        if ts_col == "created_at" and "timestamp" in header:
            ts_col = "timestamp"
        else:
            return {"tab": ws.title, "error": f"ts column {ts_col} not found in {header}"}
    col_idx = header.index(ts_col)

    to_delete: list[int] = []  # 1-based row index (row 1 은 헤더이므로 제외)
    unparseable = 0
    kept_oldest = None
    for i, row in enumerate(values[1:], start=2):
        raw = row[col_idx] if col_idx < len(row) else ""
        parsed = parse_ts(raw)
        if parsed is None:
            unparseable += 1
            continue
        if parsed < cutoff:
            to_delete.append(i)
        else:
            if kept_oldest is None or parsed < kept_oldest:
                kept_oldest = parsed

    report = {
        "tab": ws.title,
        "total_rows": len(values) - 1,
        "to_delete": len(to_delete),
        "kept": (len(values) - 1) - len(to_delete) - unparseable,
        "unparseable_kept": unparseable,
        "cutoff": cutoff.isoformat(),
        "kept_oldest": kept_oldest.isoformat() if kept_oldest else None,
        "applied": False,
    }

    if not apply or not to_delete:
        return report

    # 뒤에서부터 삭제 → 인덱스 시프트 영향 제거
    runs = list(reversed(collapse_runs(sorted(to_delete))))
    for start, end in runs:
        # batch 상한 분할
        cur_end = end
        while cur_end >= start:
            cur_start = max(start, cur_end - DELETE_BATCH_MAX + 1)
            ws.delete_rows(cur_start, cur_end)
            cur_end = cur_start - 1
            time.sleep(1.0)  # quota 보호

    # 삭제 후 실제 데이터 행 재조회 → resize
    time.sleep(2.0)
    final_values = ws.get_all_values()
    final_rows = len(final_values)
    ws.resize(rows=final_rows + RESIZE_BUFFER, cols=ws.col_count)

    report["applied"] = True
    report["final_rows"] = final_rows
    report["resized_to_rows"] = final_rows + RESIZE_BUFFER
    return report

def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="실제 삭제 수행")
    parser.add_argument("--backup-manifest", required=True, help="Step 2 manifest.json 경로")
    parser.add_argument("--tab", help="단일 탭만 처리 (디버깅용)")
    args = parser.parse_args()

    manifest = json.loads(Path(args.backup_manifest).read_text(encoding="utf-8"))
    print(f"Backup manifest loaded: {manifest['generated_at']}  "
          f"({len(manifest['tabs'])} tabs)")

    if args.apply:
        token = input("Type 'I UNDERSTAND THIS DELETES ROWS' to continue: ").strip()
        if token != "I UNDERSTAND THIS DELETES ROWS":
            print("Aborted.")
            return 2

    sheet_id = os.environ["GOOGLE_SHEET_ID"]
    creds = Credentials.from_service_account_info(
        json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"]),
        scopes=SCOPES,
    )
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(sheet_id)
    now = datetime.now(timezone.utc)

    results = []
    for tab, ts_col, days in RETENTION_RULES:
        if args.tab and args.tab != tab:
            continue
        try:
            ws = sh.worksheet(tab)
        except gspread.exceptions.WorksheetNotFound:
            print(f"[skip] {tab}: not found")
            continue
        cutoff = now - timedelta(days=days)
        print(f"\n=== {tab} (cutoff {cutoff.isoformat()}) ===")
        report = purge_tab(ws, ts_col, cutoff, apply=args.apply)
        results.append(report)
        print(json.dumps(report, indent=2, default=str))

    summary_path = Path("docs/obsidian/attachments") / (
        f"2026-04-24-sheets-purge-{'apply' if args.apply else 'dryrun'}.json"
    )
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps({
        "now": now.isoformat(),
        "apply": args.apply,
        "backup_manifest": args.backup_manifest,
        "results": results,
    }, indent=2, default=str), encoding="utf-8")
    print(f"\nSummary written to {summary_path}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

**실행 순서**:

```bash
# 1) dry-run 먼저
python -m scripts.purge_sheets_once \
  --backup-manifest backups/sheets/<STAMP>/manifest.json

# 2) dry-run 결과 육안 확인 — 각 탭의 to_delete/kept 가 기대와 일치하는지
#    특히 kept_oldest 가 cutoff 에 근접하는지
cat docs/obsidian/attachments/2026-04-24-sheets-purge-dryrun.json | jq '.results[] | {tab, to_delete, kept}'

# 3) 사용자 컨펌 후 실제 삭제
python -m scripts.purge_sheets_once --apply \
  --backup-manifest backups/sheets/<STAMP>/manifest.json
# → 콘솔에 'I UNDERSTAND THIS DELETES ROWS' 입력
```

**성공 조건**:
- 8개 탭 모두 `applied: true` + `final_rows` + `resized_to_rows` 필드 채움.
- 직후 `python -m scripts.diagnose_sheets_cells` 재실행 결과 `Total grid cells` 가 10M 대비 30% 이하로 떨어짐 (목표 3M 이하).
- 각 보존 탭 (config / display / signals 등) 의 row 수 변화 0.

**실패 시**:
- `delete_rows` API quota 초과 → 30초 대기 후 남은 탭부터 `--tab <name>` 로 재개.
- 파싱 실패 행이 예상 이상으로 많음 → Step 1 에서 탭별 샘플 timestamp 확인, 헤더 변경 이력 확인. 필요 시 cutoff 규칙 갱신 후 재실행.
- 실수 삭제 의심 → Step 2 백업에서 복구 (§5 롤백 절차).

---

### Step 4 — 크론 재개 및 엔드투엔드 검증

**산출물**: `docs/obsidian/2026-04-24-03-WhaleScope-Sheets-10M복구-검증리포트.md` (실행 결과 기록)

**역할**: 워크북이 복구되었음을 확인하고 Render 크론을 재개, 다음 사이클이 정상 동작하는지 검증.

**순서**:

1. **로컬 수동 실행**:
   ```bash
   python -m src.pipeline.run_all
   ```
   - exit 0 + `summary.status == completed` 확인.
   - 로그에 `APIError [400]` 없는지 grep.

2. **Render Dashboard**: Cron Job → `Resume`. 다음 15분 슬롯 실행을 기다림.

3. **Render 로그**: 최소 2사이클(30분) 모니터링. `service_health` 탭에 새 heartbeat 가 append 되고 있는지 확인 (Google Sheets UI 새로고침).

4. **셀 수 재확인**:
   ```bash
   python -m scripts.diagnose_sheets_cells
   ```
   - 퍼지 직후 대비 일일 증가량이 진단 리포트 추정치(~37,500 cells/day)와 정합하는지 확인.

5. **대시보드**: [라이브 URL](https://reuton-whale.vercel.app/about) 에서 탭 데이터가 정상 표시되는지 육안 확인. 특히 `daily_brief`, `signals`, `whale_stories` 는 건드리지 않았으므로 변화 없어야 함.

**성공 조건**:
- exit 0 크론 실행 1회 이상 + Render 크론 재개 후 2사이클 모두 성공.
- `/about` 페이지 작업 로그 변화 없음 (Sheets 구조 변경이 대시보드에 영향 없음을 확인).
- 스택 트레이스에 `gspread.exceptions.APIError [400]` 재발 없음 (다음 24시간).

**실패 시**:
- 크론이 또 `APIError [400]` 이면 **퍼지가 부족했음** → `service_health`, `system_log` cutoff 를 7일로 축소해 재퍼지.
- 다른 에러(기존 경고의 tg_whale_events 헤더 이슈 등) → 별도 티켓으로 분리.

---

### Step 5 — 기록 및 완료

- `docs/obsidian/2026-04-24-03-WhaleScope-Sheets-10M복구-검증리포트.md` 작성 (퍼지 전/후 셀 수 비교, 실행 로그 요약, 크론 재개 시각).
- `docs/obsidian/_manifest.json` 에 seq 02, 03 두 엔트리 추가 (`generate_manifest.py` 존재 시 재생성, 없으면 수동 append).
- `docs/obsidian/attachments/` 폴더의 모든 로그 파일 커밋.
- `scripts/diagnose_sheets_cells.py`, `scripts/backup_sheets_snapshot.py`, `scripts/purge_sheets_once.py` 커밋.
- 브랜치 PR: `recovery/sheets-10m-option-a` → main. PR 본문에 진단 리포트 + 본 실행계획 링크.
- PR merge 후 worktree 정리:
  ```bash
  git worktree remove ../wt-whale-recovery-sheets-10m
  ```
- Obsidian 볼트 `Projects/02015-WhaleScope/` 에도 검증 리포트 미러.

## 4. 안전 가드 요약

| 가드 | 위치 | 역할 |
|---|---|---|
| Render 크론 Suspend | Step 1 전 | 퍼지 중 새 쓰기 차단 |
| `.gitignore backups/` | Step 2 전 | 백업이 git 에 들어가지 않도록 |
| `get_all_values` → CSV | Step 2 | 삭제 전 전수 스냅샷 |
| manifest rows 일치 검증 | Step 3 | 백업 이후 추가 쓰기 감지 |
| `--dry-run` 기본값 | Step 3 | 실수 방지 |
| `I UNDERSTAND...` 프롬프트 | Step 3 | 사용자 명시적 컨펌 |
| 뒤에서부터 `delete_rows` | Step 3 | 인덱스 시프트 버그 방지 |
| `DELETE_BATCH_MAX = 5000` | Step 3 | quota 보호 |
| `time.sleep(1.0)` 배치 간 | Step 3 | quota rate limit 준수 |
| 파싱 불가 행 보존 | Step 3 | timestamp 스키마 변경 대비 |
| resize 후 셀 수 재측정 | Step 4 | 실제 효과 검증 |

## 5. 롤백 절차

만약 Step 3 이후 특정 탭이 잘못 삭제됐다고 판단되면:

```bash
# Step 2 백업에서 원본 CSV 확보
BACKUP=backups/sheets/<STAMP>
ls $BACKUP/
cat $BACKUP/manifest.json | jq

# 수동 복구 스크립트 (Claude Code 가 별도 작성)
# scripts/restore_tab_from_csv.py 
#   --tab <name>
#   --csv $BACKUP/<tab>.csv
#   --mode append|replace
```

복구 모드:
- `append`: 현재 잔존 행 뒤에 CSV 전체를 붙임 (중복 가능, dedup 직접 필요).
- `replace`: 해당 워크시트를 `ws.clear()` 후 CSV 를 처음부터 다시 적재 (헤더 포함, 가장 안전).

실제 롤백이 필요한 상황은 드물지만, 절차는 반드시 본 티켓 완료 전 시연 1회 (dry-run) 로 검증.

## 6. 검증 기준 (완료 판정)

본 티켓은 다음을 **모두 만족할 때** 완료:

- [ ] `scripts/diagnose_sheets_cells.py`, `scripts/backup_sheets_snapshot.py`, `scripts/purge_sheets_once.py` 커밋.
- [ ] `backups/sheets/<STAMP>/` 20개 CSV + manifest.json 생성 + 사용자가 manifest 확인.
- [ ] dry-run JSON 리포트 `2026-04-24-sheets-purge-dryrun.json` 에 8개 탭 결과 모두 기록.
- [ ] `--apply` 실행 후 각 탭 `applied: true`, 총 셀 수 3M 이하.
- [ ] Render 크론 재개 후 최소 2사이클 exit 0.
- [ ] `/about` 대시보드 탭 구조 및 데이터 무결성 육안 확인.
- [ ] `2026-04-24-03-...-복구-검증리포트.md` 작성 + `_manifest.json` 갱신.
- [ ] PR `recovery/sheets-10m-option-a` merge.

## 7. 심사위원 영향 평가

본 작업의 외부(심사위원 관점) 영향:

- **무영향** (의도): `daily_brief`, `whale_stories`, `signals`, `curated_wallets`, `watched_addresses`, `subscribers`, `news_feed`. 이 탭들은 퍼지 대상이 아니며 대시보드 / Telegram 봇 / `/about` 출력과 직결.
- **미세 영향**: "최근 2주 이전 운영 히스토리" 가 대시보드에서 사라질 수 있음. 구체적으로:
  - `service_health` → `/about` 4탭에서 표시되지 않음. 내부 모니터링용.
  - `system_log` → 동일. 크론 실행 로그.
  - `market_snapshots` → 대시보드가 해당 탭을 직접 읽는지 확인 필요. 읽는다면 "최근 14일" 으로 자연스럽게 축소됨 (문제 없음).
- **긍정 효과**: 크론이 다시 돌기 시작하므로 **현재 stale 상태인 실시간 데이터가 정상화** 됨. 심사 시점에 stale 데이터가 없다는 건 더 큰 가치.

## 8. Claude Code 인수인계 메모

### 8.1 본 문서를 처음 여는 Claude Code 에게

1. 먼저 `docs/obsidian/2026-04-24-01-WhaleScope-Sheets-10M셀한도-진단리포트.md` 를 읽어 배경 이해.
2. 본 문서(§2 보존 규칙, §3 스텝) 를 단 하나도 건너뛰지 말 것.
3. 코드 변경은 `scripts/` 3개 파일 추가만 허용. `src/` 와 `apps/` 는 건드리지 말 것 (Option B 는 별도 티켓).
4. destructive 실행은 반드시 사용자 콘솔에서 `--apply` + 확인 문구 입력으로만 발동. 자동 실행 금지.
5. Step 간 사용자 컨펌 지점 (Step 1→2, Step 2→3, Step 3→4) 을 지킬 것.
6. 완료 후 본 티켓 상태를 `completed` 로 갱신하고 PR URL 을 `2026-04-24-03-...-복구-검증리포트.md` 맨 위에 기록.

### 8.2 트러블슈팅 Q&A

- **Q: dry-run 결과가 예상과 크게 다르면?** → 즉시 중단. 사용자에게 보고하고 Step 1 인벤토리부터 재검토.
- **Q: 퍼지 중간에 에러?** → 이미 삭제된 부분은 rollback 불가. 남은 탭부터 `--tab` 플래그로 재개. 전체 롤백이 필요하면 §5 절차.
- **Q: Redis L2 캐시는?** → 본 작업과 무관. `WHALESCOPE_REDIS_REST_URL` 은 건드리지 않음.
- **Q: 진단 리포트의 Option B (retention 코드 내장) 는 언제?** → 본 티켓 완료 후 별도 티켓 `recovery/sheets-10m-option-b` 로 진행. 사용자가 Option B 를 승인해야 착수.

## 9. 변경 로그

- **2026-04-24** — Cowork 세션에서 초안 작성. 8개 탭 cutoff 고정, 스크립트 3종 골격 포함, 안전 가드 11개 명시. Claude Code 인수 대기.

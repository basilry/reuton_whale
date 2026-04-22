# 메트릭 스냅샷

KPI 실측 값의 수동 스냅샷 모음. 생성 스크립트는 리포지토리 루트 `scripts/` 아래에 있으며, 각 스냅샷은 `YYYYMMDD` 또는 `YYYYMMDD_HHMM` 접미사로 구분한다.

## 생성 규칙

| 파일 | 생성 스크립트 | 주기 |
|---|---|---|
| `tg_snapshot_YYYYMMDD.md` | `scripts/snapshot_telegram_metrics.py` | 주 1회 수동 |
| `brief_cost_YYYYMMDD.md` | (예정) `scripts/snapshot_brief_cost.py` | 월 1회 |

자동화는 Phase 3 [P3-5]에서 cron + PR 자동 생성으로 이관 예정. 현재는 운영자가 주 1회 수동 실행 후 커밋한다.

## 참조

- ONE_PAGER `§4 성공 지표`의 **4-6 실측 스냅샷** 표가 본 폴더의 최신 파일을 인용한다.
- 텔레그램 발송/열람률 실측은 `tg_whale_events` 시트와 함께 해석한다.

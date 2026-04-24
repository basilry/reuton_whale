# WhaleScope PostgreSQL Migration Runbook

## 목적

Google Sheets 10M cell limit을 피하기 위해 Render cron은 유지하되, 운영 write/read의 primary storage를 PostgreSQL로 전환한다. Sheets는 emergency fallback 또는 저빈도 summary mirror로만 유지한다.

## 전환 순서

1. Render PostgreSQL 또는 외부 PostgreSQL을 생성한다.
2. Render pipeline/listener/bot 서비스에 `DATABASE_URL`, `STORAGE_BACKEND=postgres`, `SHEETS_WRITE_MODE=summary_only`를 추가한다.
3. Vercel dashboard에 `DATABASE_URL`, `DASHBOARD_DATA_BACKEND=postgres`를 추가한다.
4. 스키마를 dry-run으로 확인한다.

```bash
python -m scripts.init_postgres --dry-run
```

5. 스키마를 실제 적용한다.

```bash
python -m scripts.init_postgres
```

6. migration dry-run을 먼저 실행한다. 기본 dry-run은 Sheets를 읽지 않는다.

```bash
python -m scripts.migrate_sheets_to_postgres --dry-run
```

7. Sheets source count까지 확인하려면 read-source를 붙인다. 10M 장애 중에는 quota가 회복된 뒤 실행한다.

```bash
python -m scripts.migrate_sheets_to_postgres --dry-run --read-source --since-days 90
```

8. batch migration을 실행한다.

```bash
python -m scripts.migrate_sheets_to_postgres --since-days 90 --batch-size 1000
```

9. count validation을 실행한다.

```bash
python -m scripts.validate_postgres_counts --limit 5000
```

10. Render cron 2회, Vercel `/admin`, Telegram bot/listener log를 확인한다.

## 필수 환경변수

- `STORAGE_BACKEND=postgres`
- `DATABASE_URL=<postgres connection url>`
- `SHEETS_WRITE_MODE=summary_only` 또는 `disabled`
- `DASHBOARD_DATA_BACKEND=postgres`
- 기존 Google Sheets env는 migration/fallback용으로 유지 가능

## 검증 기준

- Render cron `python -m src.pipeline.run_all`이 2회 연속 exit 0 또는 controlled `completed_with_errors`로 종료한다.
- `service_health`, `system_log`, `transactions`, `address_activity`가 Postgres에서 증가한다.
- `/admin`의 source가 `postgres`로 표시된다.
- Sheets 10M cell limit error가 새 cron 실패 원인이 되지 않는다.
- Sheets workbook은 purge/resize emergency tool로만 관리한다.

## 롤백

- Dashboard만 문제: Vercel `DASHBOARD_DATA_BACKEND=sheets`로 되돌린다.
- Pipeline만 문제: Render `STORAGE_BACKEND=sheets`, `SHEETS_WRITE_MODE=summary_only`로 임시 복귀한다.
- Sheets가 이미 10M 한도에 있으면 full Sheets rollback은 불가능하다. 이 경우 `SHEETS_WRITE_MODE=disabled`로 cron 생존을 우선한다.

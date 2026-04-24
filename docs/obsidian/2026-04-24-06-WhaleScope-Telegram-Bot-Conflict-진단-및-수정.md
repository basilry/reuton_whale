---
type: incident-report
date: 2026-04-24
seq: "06"
status: code-fixed-needs-render-restart
tags:
  - WhaleScope
  - telegram
  - render
  - bot
  - broadcast
related:
  - 2026-04-20-02-WhaleScope-텔레그램-사이클-점검-및-봇-미발송-근본원인-분석.md
---

# WhaleScope Telegram Bot Conflict 진단 및 수정

## 1. 증상

Render bot worker 로그에 다음 오류가 반복됐다.

```text
telegram.error.Conflict: Conflict: terminated by other getUpdates request;
make sure that only one bot instance is running
No error handlers are registered, logging exception.
```

동시에 Telegram 공개 채널에 주기적인 alert가 보이지 않는 문제가 관찰됐다.

## 2. 원인 분리

### 2.1 `getUpdates Conflict`

Telegram Bot API long polling은 같은 bot token에 대해 하나의 `getUpdates` consumer만 허용한다.

가능 원인:

- Render에 `python scripts/run_bot.py`를 실행하는 서비스가 2개 이상 존재
- 재배포 중 이전 bot 인스턴스가 SIGTERM에 바로 종료되지 않아 새 인스턴스와 충돌
- 동일 `TELEGRAM_BOT_TOKEN`을 다른 로컬/클라우드 프로세스가 polling 중
- webhook/pending update 상태가 정리되지 않은 채 polling을 시작

기존 코드 문제:

- `scripts/run_bot.py`가 `app.run_polling(stop_signals=None)`로 실행되어 Render SIGTERM 처리와 맞지 않았다.
- `drop_pending_updates=True`가 없어 polling 시작 전 pending update/webhook 정리가 명시되지 않았다.
- `WhaleScopeBot`에 error handler가 없어 Conflict가 noisy traceback으로만 남았다.

### 2.2 주기적 채널 alert 미발송

공개 채널 broadcast는 `scripts/run_bot.py`가 아니라 Render cron `python -m src.pipeline.run_all` 내부의 `broadcast_periodic` / `broadcast_daily`가 담당한다.

원격 `/api/dashboard` 확인 결과:

```json
{
  "periodic": {
    "windowHours": 24,
    "totalExecutions": 28,
    "skippedEmpty": { "count": 28, "ratio": 1 },
    "skippedDuplicateContent": { "count": 0, "ratio": 0 },
    "latestMessageLength": 0,
    "latestPeriodicSendAt": "2026-04-23T03:48:46.890Z"
  },
  "telegram": {
    "lastBroadcastAt": "2026-04-24T04:30:33.848Z",
    "lastBroadcastDeliveryMode": "skipped",
    "lastBroadcastStatus": "skipped_empty"
  }
}
```

따라서 채널에 메시지가 안 보이는 직접 상태는 최근 24시간 `broadcast_periodic`가 모두 `skipped_empty`인 것이다. 이는 최근 15분 윈도우에 발송할 signal/transaction row가 없다고 판단했다는 뜻이다.

## 3. 코드 수정

### 3.1 Bot polling 안정화

수정 파일:

- `scripts/run_bot.py`
- `src/distributor/telegram_bot.py`

변경:

- `app.run_polling(stop_signals=None)` 제거
- `app.run_polling(drop_pending_updates=True)` 적용
- `WhaleScopeBot.build()`에서 `add_error_handler(self.handle_error)` 등록
- `telegram.error.Conflict` 발생 시 중복 bot worker 정리 안내 로그 출력

효과:

- Render 재배포 시 SIGTERM 기본 처리를 사용한다.
- polling 시작 전 pending update/webhook 정리를 명시한다.
- Conflict가 발생해도 운영자가 원인을 읽을 수 있는 로그로 남는다.

## 4. 운영 조치

코드 배포 후 Render에서 반드시 확인할 것:

1. `python scripts/run_bot.py`를 실행하는 Render 서비스가 정확히 1개인지 확인한다.
2. 같은 `TELEGRAM_BOT_TOKEN`을 쓰는 중복 서비스가 있으면 stop/delete 하거나 token env를 제거한다.
3. 남길 bot worker를 Manual Restart 한다.
4. 로그에서 `Starting WhaleScope bot polling with drop_pending_updates=true...`가 보이는지 확인한다.
5. 이후 `Conflict: terminated by other getUpdates request`가 계속 나오면 코드 문제가 아니라 다른 polling consumer가 아직 살아 있는 것이다.

채널 alert가 계속 보이지 않으면 다음 순서로 확인한다.

1. `/api/dashboard` → `adminObservability.periodic.lastBroadcastStatus`
2. `broadcast_log` → `kind=broadcast_periodic` 최신 row
3. `skipped_empty`면 최근 15분 발송 대상 데이터가 없는 상태
4. `skipped_disabled`면 `TELEGRAM_BROADCAST_ENABLED=true` 필요
5. `dry_run`이면 `TELEGRAM_BROADCAST_DRY_RUN=false` 필요
6. `failed`면 `TELEGRAM_BROADCAST_CHAT`, bot channel admin 권한, token을 확인

## 5. 검증

로컬 테스트:

```bash
pytest -q tests/test_run_bot.py tests/test_distributor.py
pytest -q tests/test_broadcast_periodic.py tests/test_run_all.py
```

결과:

- bot polling 옵션 테스트 통과
- bot error handler 등록/Conflict logging 테스트 통과
- periodic broadcast / run_all 회귀 테스트 통과

## 6. 남은 판단

`skipped_empty` 자체는 실패가 아니라 정책이다. “15분마다 무조건 생존 메시지를 보낼지”와 “실제 이동/시그널이 있을 때만 alert를 보낼지”는 제품 정책 결정이다.

현재 구현은 후자다. 빈 슬롯에도 채널 heartbeat를 보내려면 별도 옵션을 추가해야 하지만, 공개 채널 스팸 위험이 있어 이번 수정에서는 제외했다.


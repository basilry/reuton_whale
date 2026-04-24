---
type: incident-analysis
date: 2026-04-24
seq: "07"
status: analyzed
tags:
  - WhaleScope
  - telegram
  - broadcast
  - render
  - postgres
related:
  - 2026-04-24-06-WhaleScope-Telegram-Bot-Conflict-진단-및-수정.md
  - 2026-04-20-02-WhaleScope-텔레그램-사이클-점검-및-봇-미발송-근본원인-분석.md
---

# WhaleScope Telegram 메시지 미수신 원인분석 보고서

## 1. 결론

Telegram 메시지가 오지 않는 원인은 하나가 아니라 두 레인으로 분리된다.

1. **공개 채널 주기 alert 미발송**
   - 직접 원인: `broadcast_periodic`가 실행은 되지만 `skipped_empty`로 종료된다.
   - 의미: 최근 15분 윈도우에서 발송할 `signals=0`, `transactions=0`으로 판단되어 `sendMessage` 호출 전에 return한다.
   - 현재 관측상 `TELEGRAM_BROADCAST_ENABLED=false`나 `DRY_RUN=true`가 직접 원인이라는 증거는 없다. 그보다 앞단의 데이터 게이트에서 막힌다.

2. **개인 DM / bot 명령 응답 미수신**
   - 직접 원인 후보: `telegram.error.Conflict: terminated by other getUpdates request`.
   - 의미: 같은 `TELEGRAM_BOT_TOKEN`으로 long polling 중인 bot 인스턴스가 2개 이상 있다.
   - 이 문제는 `/start`, `/status`, `/watchlist` 같은 사용자 DM 명령 수신을 막을 수 있다.

따라서 **파이프라인이 돌아서 봇이 안 도는 것이 아니다.** 파이프라인은 돌고 있고, bot conflict와 periodic skipped-empty는 서로 다른 문제다.

## 2. 원격 관측 증거

확인 시각: 2026-04-24 14:52 KST 전후  
확인 대상: `https://whalescope.6esk.com/api/dashboard`, `/api/admin/health`, `/api/transactions`, `/api/signals`, `/api/system-log`

### 2.1 Dashboard source

```json
{
  "source": "postgres",
  "sourceHealth": {
    "label": "Live Postgres",
    "staleMinutes": 7,
    "failureKind": null
  }
}
```

저장소/대시보드 연결 자체는 정상이다. 즉 “대시보드가 Postgres를 못 읽어서 broadcast 상태가 비어 보이는 문제”는 아니다.

### 2.2 Periodic broadcast 상태

```json
{
  "periodic": {
    "windowHours": 24,
    "totalExecutions": 27,
    "skippedEmpty": {
      "count": 27,
      "ratio": 1
    },
    "skippedDuplicateContent": {
      "count": 0,
      "ratio": 0
    },
    "latestMessageLength": 0,
    "latestPeriodicSendAt": "2026-04-23T03:48:46.890Z"
  },
  "telegram": {
    "channelMemberCountLatest": 2,
    "lastBroadcastAt": "2026-04-24T05:45:24.588Z",
    "lastBroadcastDeliveryMode": "skipped",
    "lastBroadcastStatus": "skipped_empty"
  }
}
```

판정:

- 최근 24시간 `broadcast_periodic` 27회가 모두 `skipped_empty`.
- 최신 broadcast log도 `skipped_empty`.
- 채널 인원은 읽히므로 `TELEGRAM_BROADCAST_CHAT` 자체가 완전히 잘못됐다고 보기는 어렵다.

### 2.3 System log 최신 broadcast row

```json
{
  "run_id": "broadcast_periodic_20260424_054523",
  "run_type": "broadcast_periodic",
  "status": "skipped_empty",
  "started_at": "2026-04-24T05:45:23.898Z",
  "finished_at": "2026-04-24T05:45:24.791Z",
  "transactions_count": "0",
  "errors": "[]",
  "details": "signals=0; transactions=0; recent_window=15m"
}
```

판정:

- pipeline job은 실행됐다.
- 실패가 아니라 의도된 skip이다.
- Telegram API 호출 실패가 아니라 Telegram 호출 전 데이터 조건에서 종료됐다.

### 2.4 최신 transaction/signal 시각

최신 transaction API 응답 기준:

- 최신 transaction `created_at`: `2026-04-23T03:47:39.744Z`
- KST 기준: 2026-04-23 12:47:39
- 현재 확인 시각 대비 약 26시간 이상 오래됨

최신 signal API 응답 기준:

- 최신 signal `created_at`: `2026-04-21T19:03:04.979Z`
- KST 기준: 2026-04-22 04:03:04
- 현재 확인 시각 대비 약 58시간 이상 오래됨

의미:

- `broadcast_periodic`는 최근 15분 윈도우를 본다.
- 최신 transaction/signal이 각각 26시간, 58시간 이상 오래됐으므로 최근 15분 발송 대상이 비는 것은 현재 데이터 기준으로 정상이다.
- `news_rss`는 최신으로 돌고 있지만, periodic alert는 news가 아니라 `signals`와 `transactions`만 사용한다.

## 3. 코드 경로 분석

### 3.1 `broadcast_periodic`

파일: `src/pipeline/broadcast_periodic.py`

핵심 흐름:

```python
signal_rows = sheets.list_signals(since=window_start, limit=20)
transaction_rows = sheets.list_transactions(since=window_start, limit=50)

if not signal_rows and not transaction_rows:
    status = "skipped_empty"
    return result
```

중요한 점:

- `window_start`는 현재 15분 슬롯 시작 시각이다.
- signal과 transaction이 둘 다 없으면 `TelegramBroadcastAdapter` 생성 전에 return한다.
- 따라서 이 상태에서는 `TELEGRAM_BROADCAST_ENABLED`, `TELEGRAM_BROADCAST_DRY_RUN`, bot token, chat id가 맞아도 메시지를 보내지 않는다.

### 3.2 `TelegramBroadcastAdapter`

파일: `src/notify/telegram_broadcast.py`

`sendMessage`까지 가려면 아래 순서를 통과해야 한다.

1. 메시지 text가 비어 있지 않아야 함.
2. `TELEGRAM_BROADCAST_ENABLED=true`.
3. `TELEGRAM_BROADCAST_CHAT`과 token이 있어야 함.
4. `TELEGRAM_BROADCAST_DRY_RUN=false`.
5. `requests.post(.../sendMessage)` 호출.

현재는 1번보다 앞의 `broadcast_periodic` 데이터 조건에서 종료된다. 따라서 현상만 보면 “환경변수 때문에 막힘”이 아니라 “보낼 메시지 생성 대상이 없음”이 우선 원인이다.

단, 다음에 signal/transaction이 생기면 그때는 2~4번 게이트가 다시 중요해진다. Render 환경에는 아래 값이 필요하다.

```text
TELEGRAM_BROADCAST_ENABLED=true
TELEGRAM_BROADCAST_DRY_RUN=false
TELEGRAM_BROADCAST_CHAT=@whalescope_alertz
TELEGRAM_BOT_TOKEN 또는 TELEGRAM_BROADCAST_BOT_TOKEN
```

### 3.3 `broadcast_daily`

파일: `src/pipeline/broadcast_daily.py`

`broadcast_daily`는 매 15분이 아니라 KST 09:00 슬롯에서만 발송한다.

```python
if not force and not _is_broadcast_window(now):
    status = "skipped_window"
    return result
```

따라서 사용자가 “주기적인 alert”를 기대했다면, 매 15분 메시지는 `broadcast_periodic`만 담당한다. `broadcast_daily`는 하루 1회 브리핑이다.

### 3.4 `run_bot.py`

파일: `scripts/run_bot.py`

`run_bot.py`는 공개 채널 periodic alert의 주체가 아니다. 이 프로세스는 `/start`, `/pause`, `/status`, `/watchlist` 같은 사용자 명령을 long polling으로 받는다.

최근 적용한 코드:

```python
app.run_polling(drop_pending_updates=True)
```

그리고 `WhaleScopeBot`은 `Conflict` error handler를 등록한다.

이 조치는 bot worker 안정화에 필요하지만, `broadcast_periodic skipped_empty` 자체를 해결하지는 않는다.

## 4. 원인 트리

```text
Telegram 메시지 안 옴
├─ 공개 채널 periodic alert 안 옴
│  ├─ pipeline은 실행됨
│  ├─ broadcast_periodic도 실행됨
│  ├─ 최근 24h 27회 모두 skipped_empty
│  ├─ 최신 transaction이 약 26h 전
│  ├─ 최신 signal이 약 58h 전
│  └─ 따라서 최근 15분 alert payload가 없어 sendMessage 전 return
│
└─ 개인 DM / bot 명령 응답 안 옴
   ├─ Render 로그에 getUpdates Conflict
   ├─ 같은 bot token polling consumer가 2개 이상
   ├─ run_bot.py 중복 서비스, 구 인스턴스, 로컬 polling 중 하나
   └─ /start 등 사용자 명령 수신이 막힐 수 있음
```

## 5. 실행해야 할 확인 순서

### 5.1 Render bot worker 중복 제거

목적: DM/명령 응답 경로 복구

1. Render에서 `python scripts/run_bot.py`를 실행하는 서비스가 몇 개인지 확인.
2. 같은 `TELEGRAM_BOT_TOKEN`을 쓰는 bot worker가 2개 이상이면 하나만 남긴다.
3. 로컬에서 같은 token으로 `python scripts/run_bot.py`를 켜둔 터미널이 있으면 종료한다.
4. 남길 Render bot worker를 Manual Restart.
5. 로그에서 아래 문구 확인:

```text
Starting WhaleScope bot polling with drop_pending_updates=true...
```

6. 이후에도 `Conflict`가 계속 나오면 아직 다른 polling consumer가 살아 있는 것이다.

### 5.2 Broadcast env 확인

목적: 데이터가 생겼을 때 실제 채널 발송이 가능한지 확인

Render pipeline service에 아래 값이 있는지 확인한다.

```text
TELEGRAM_BROADCAST_ENABLED=true
TELEGRAM_BROADCAST_DRY_RUN=false
TELEGRAM_BROADCAST_CHAT=@whalescope_alertz
TELEGRAM_BOT_TOKEN=<채널 admin 권한 있는 bot token>
```

`TELEGRAM_BROADCAST_BOT_TOKEN`은 별도 broadcast 전용 bot을 쓸 때만 필요하다. 비워두면 `TELEGRAM_BOT_TOKEN`으로 fallback한다.

### 5.3 Chain/Signal freshness 확인

목적: `skipped_empty`의 실제 원인을 해소

확인할 지표:

- `/api/transactions?limit=5` 최신 `created_at`
- `/api/signals?limit=5` 최신 `created_at`
- `/api/system-log?limit=10` 최신 `signals` pipeline row
- Render `run_all` 로그의 `stored_transactions`, `duplicates skipped`, `signals=0`

현재 관측상 핵심 문제는 transaction/signal freshness다. 최신 transaction이 26시간 이상 오래됐기 때문에 15분 periodic alert가 비는 것은 당연하다.

가능 원인:

- 감시 지갑의 실제 온체인 활동이 최근 15분에 없음.
- collector가 같은 과거 transaction만 반복 수집하고 Postgres unique key에서 중복 skip.
- `amount_usd=0`/owner unknown이 많아 signal 조건을 만족하지 못함.
- signal detector threshold가 현재 데이터 밀도 대비 너무 높음.
- periodic 윈도우 15분이 sparse watchlist에 비해 너무 짧음.

## 6. 제품 정책 선택지

현재 정책은 “이벤트가 있을 때만 보낸다”이다. 그래서 빈 슬롯에는 메시지를 보내지 않는다.

선택지:

1. 현행 유지
   - 장점: 채널 스팸 방지.
   - 단점: 데이터가 희박하면 사용자는 죽은 서비스처럼 느낀다.

2. 빈 슬롯 heartbeat 발송
   - 예: `최근 15분 대형 이동 없음. 다음 점검 15분 후.`
   - 장점: 서비스 생존감.
   - 단점: 공개 채널 품질 저하, 알림 피로.

3. 발송 윈도우 확대
   - 예: 15분 대신 1시간 또는 6시간 lookback.
   - 장점: sparse 데이터에서도 메시지 빈도 확보.
   - 단점: “실시간 alert” 성격 약화, 중복/지연 메시지 위험.

4. fallback briefing 사용
   - 최근 signal/transaction이 없으면 최신 `daily_brief`나 `news_feed` 기반으로 간단한 시장 브리핑 발송.
   - 장점: 채널 활성도 유지.
   - 단점: whale alert 채널의 정체성이 흐려질 수 있음.

권장:

- 과제 데모 목적이면 3번 또는 4번을 제한적으로 적용하는 것이 낫다.
- 운영 제품 목적이면 1번을 유지하되 `/admin`에서 `skipped_empty`를 “정상 무이벤트”로 명확히 표시해야 한다.

## 7. 최종 판정

| 항목 | 판정 |
|---|---|
| pipeline 실행 여부 | 실행 중 |
| Postgres 연결 | 정상 |
| public channel periodic 미발송 직접 원인 | `broadcast_periodic` 전부 `skipped_empty` |
| `sendMessage` 실패 여부 | 현재 증거 없음. 호출 전 return |
| broadcast env 문제 여부 | 현재는 데이터 게이트가 먼저 막혀 확정 불가. 데이터 발생 시 재검증 필요 |
| bot DM/명령 미수신 원인 | `getUpdates Conflict` 가능성이 큼 |
| 즉시 해야 할 일 | Render bot worker 중복 제거 + transaction/signal freshness 확인 |


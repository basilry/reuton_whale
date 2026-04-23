---
type: report
project: WhaleScope
date: 2026-04-18
sequence: 7
status: updated
tags:
  - whalescope
  - user-home
  - qa
  - code-review
  - implementation
related:
  - "[[2026-04-18-05-WhaleScope-유저홈-종합개선안-v2]]"
  - "[[2026-04-18-06-WhaleScope-브리핑-시장분위기-데이터파이프라인-재설계]]"
  - "[[2026-04-18-03-WhaleScope-감시지갑-큐레이션-고래스토리-기획]]"
  - "[[2026-04-18-04-WhaleScope-유저홈-실시간-티커-차트-기획]]"
---

# WhaleScope 유저홈 v2 개발 · QA · 코드리뷰 종합보고서

## 0. 결론

이번 작업으로 유저홈(`/`)은 문서 기준의 **전술 UI 항목** 상당수를 실제 코드에 반영했다.

- `브리핑 / 시그널 / 감시 지갑 / 텔레그램` 중심의 **사용자 홈 구조**가 루트 페이지에 정렬됨
- `큐레이션 감시 지갑`, `고래 스토리`, `텔레그램 QR 모달`, `실시간 시장 티커` 가 실제 화면에 연결됨
- `/admin` 운영 화면과 `/` 사용자 화면의 역할 분리가 유지됨
- 파이프라인 쪽에서는 `tg_whale_events → raw_events → SignalEngine`, `daily_brief.highlight/signal_themes/note`, `signal extra enrichment` 가 코드상 반영됨

다만 전략 문서 기준으로는 아직 **Phase 0~1 수준**이다.

- 큐레이션 지갑 레지스트리는 아직 **메모리 시드 + 임시 override** 수준
- 실시간 티커는 아직 **Binance 중심**, Upbit/KRW/김치 프리미엄은 미구현
- 운영 보안은 아직 **fail-closed** 가 아님

---

## 1. 문서 정합성 수정

Claude Co-work 문서 4종과 현재 코드 상태를 대조해 다음 불일치를 먼저 수정했다.

### 1.1 수정한 항목

- `/ops` 표기를 전부 `/admin` 으로 정정
- `"Google Sheets 연결됨"`, `"DB 연결"` 계열 표현을 전부 **`데이터 연결`** 로 정정
- 텔레그램 CTA의 현재 상태를 `"직접 봇 링크 + QR 모달"` 기준으로 문구 수정
- `insights/page.tsx` 는 별도 사용자 홈이 아니라 `/` 리다이렉트라는 점을 문서에 맞춤

### 1.2 반영 위치

- `2026-04-18-WhaleScope-유저홈-종합개선안-v2`
- `2026-04-18-WhaleScope-브리핑-시장분위기-데이터파이프라인-재설계`
- `2026-04-18-WhaleScope-유저홈-실시간-티커-차트-기획`

---

## 2. 이번 개발 반영 내역

## 2.1 사용자 홈(`/`) 통합

반영 파일:

- `apps/dashboard/app/page.tsx`
- `apps/dashboard/app/insights/insights.module.css`
- `apps/dashboard/components/insights-sidebar.tsx`
- `apps/dashboard/components/market-ticker-strip.tsx`
- `apps/dashboard/components/telegram-connect-modal.tsx`
- `apps/dashboard/lib/public-app-config.ts`

적용 내용:

- 루트 페이지 메타를 `User Home` 기준으로 정리
- 상단에 `MarketTickerStrip` 연결
- 기존 임시 `buildWatchlist()` / `buildStories()` 제거
- `getDashboardData()` 가 제공하는 `watchlist`, `whaleStories` 를 직접 사용하도록 통합
- `"나의 관심 목록"` 을 `"큐레이션 감시 지갑"` 으로 교체
- 사용자 홈의 `WatchlistEditor` 제거
- 사이드바 `"감시 목록"` 을 `"감시 지갑"` 으로 교체
- 사이드바 브랜드 서브타이틀을 `User Home` 으로 교체
- 텔레그램 CTA는 QR 모달 컴포넌트 사용으로 통일

### 2.2 전략 문서와의 대응 상태

#### 문서 #1 Master 전술 항목

- `#1 사이드바 스크롤 스파이 + 설정 제거`: 반영
- `#6 텔레그램 QR 모달`: 반영
- `#7 리스크 카드 정리`: 이미 반영된 상태 유지
- `#8 "Google Sheets 연결됨" → "데이터 연결"`: 반영

#### 문서 #2 브리핑·시장분위기·파이프라인

- `daily_brief.highlights / signal_themes / note` 저장: 반영
- `signal extra enrichment(asset/exchange/direction/quote_basis)` 저장: 반영
- `tg_whale_events` 를 `raw_events` 로 합쳐 SignalEngine에 투입: 반영
- `BriefRecord v2`, freshness/staleness 기반 UI, exchange dimension 확장: 미반영

#### 문서 #3 감시지갑 큐레이션 & 고래 스토리

- `큐레이션 지갑` 개념을 사용자 홈 UI에 반영: 반영
- `고래 스토리` 를 별도 빌더로 분리: 반영
- `curated_wallets / wallet_aliases / wallet_activity_snapshots` 저장 구조: 미반영
- 영속 저장 기반 큐레이션 운영 플로우: 미반영

#### 문서 #4 실시간 티커 & 차트

- 사용자 홈 상단 티커 스트립 추가: 반영
- 브라우저 실시간 WebSocket + REST fallback: 반영
- Upbit/KRW/김치 프리미엄/미니차트/lightweight-charts: 미반영

---

## 3. 파이프라인 상태 점검

## 3.1 기존 리뷰 이슈 기준 재확인

### 이미 해결된 항목

1. `tg_whale_events` 가 signal pipeline에 들어가지 않던 문제
   - 현재 `src/main.py` 에서 `sheets.list_tg_whale_events(since=...)` 를 읽어 `raw_events` 에 합친 뒤 `engine.run(raw_events, ...)` 으로 전달함

2. Telethon listener의 동기 I/O로 이벤트 루프가 막히던 문제
   - 현재 `asyncio.to_thread(...)` 로 LLM 호출, Sheets append, system_log append 를 우회함

3. 운영 대시보드 listener 상태가 Sheets 연결로 추정되던 문제
   - 현재 `listenerHealth` 가 `system_log + tg_whale_events` 기반으로 계산됨

4. 공용 페이지의 내부 에러 메시지 노출 문제
   - `/insights` 는 `/` 로 리다이렉트되고, 사용자 홈은 연결 실패 시 generic fallback만 렌더링함

### 부분 해결 또는 잔존 이슈

1. 운영 API는 generic error + auth 체크가 들어갔지만,
   - `DASHBOARD_PASSWORD` 가 비어 있으면 사실상 공개 모드로 열림
   - `/admin` 페이지 자체는 별도 접근 제어가 없음

---

## 4. QA 결과

실행 일시: 2026-04-18 KST

### 4.1 정적 검증

- `npm run dashboard:typecheck` → 통과
- `npm run dashboard:lint` → 통과
- `npm run dashboard:build` → 통과

### 4.2 Python 테스트

- `pytest tests/test_main.py tests/test_signal_formatters.py tests/test_storage_new_tabs.py`
  - 결과: `50 passed`
  - 비고: 기존 pydantic warning 1건 유지

### 4.3 런타임 라우트 확인

개발 서버 실행 후 응답만 점검:

- `GET /` → `200 OK`
- `GET /admin` → `200 OK`
- `GET /insights` → `308 Permanent Redirect` to `/`

### 4.4 QA 판단

- 이번 반영 범위 기준으로 **타입/린트/빌드/기본 라우팅은 정상**
- 사용자 홈 통합 과정에서 발생할 수 있던 key 충돌, import 오류, route 오동작은 이번 범위에서 재현되지 않음

---

## 5. 코드리뷰 결과

아래는 **지금 시점에서 실제로 남아 있는** 주요 이슈다.

### Finding A — Major

- 위치: `apps/dashboard/lib/auth.ts:47-72`
- 문제: `DASHBOARD_PASSWORD` 가 비어 있으면 `authorized: true` 로 처리되어 운영 API가 사실상 공개 모드가 된다.
- 왜 문제인가:
  - Vercel/운영 환경에서 env 누락 한 번으로 `/api/dashboard`, `/api/system-log`, `/api/transactions`, `/api/signals` 가 외부에 열릴 수 있다.
  - 기존 "public API raw exposure" 이슈는 코드상 완화됐지만, **구성 실수에 취약한 fail-open 구조**가 남아 있다.
- 최소 수정 방향:
  - production 에서는 `DASHBOARD_PASSWORD` 미설정 시 **fail-closed** 로 바꾸고
  - `/admin` 경로 자체에도 동일한 보호 계층을 추가할 것

### Finding B — Major

- 위치: `apps/dashboard/lib/curated-wallets.ts:47-102`, `apps/dashboard/lib/curated-wallets.ts:212-226`
- 문제: 큐레이션 지갑 레지스트리와 enabled 상태가 코드 내 seed 배열 + 메모리 Map 에만 존재한다.
- 왜 문제인가:
  - 서버 재시작, Vercel 재배포, Render 재기동 시 사용자/운영자가 바꾼 상태가 모두 사라진다.
  - 문서에서 정의한 `curated_wallets / wallet_aliases / wallet_activity_snapshots` 방향과도 다르다.
- 최소 수정 방향:
  - Google Sheets 탭 기반 영속 저장으로 전환하고
  - `/api/watchlist PATCH` 가 메모리 Map 이 아니라 실제 저장소에 쓰도록 바꿀 것

### Finding C — Minor

- 위치: `apps/dashboard/lib/public-app-config.ts:18-25`
- 문제: 텔레그램 QR 코드가 외부 서비스(`api.qrserver.com`)에 의존한다.
- 왜 문제인가:
  - 네트워크 차단, CSP, 해당 서비스 장애 시 모달의 핵심 진입점 하나가 사라진다.
  - 현재는 링크 복사/봇 열기 fallback 이 있어서 치명적이진 않다.
- 최소 수정 방향:
  - 내부 API에서 SVG/PNG QR 생성 또는 정적 pre-generated QR 자산으로 교체할 것

---

## 6. 다관점 리뷰

## 6.1 Product / UX 관점

좋아진 점:

- 루트 `/` 가 확실히 사용자 홈처럼 읽힌다
- 운영성 정보보다 브리핑/시그널/스토리/텔레그램 CTA가 전면에 온다
- `"나의 관심 목록"` 이라는 오해 유발 표현이 `"큐레이션 감시 지갑"` 으로 바뀌어 의미가 명확해졌다

남은 점:

- 티커가 들어왔지만 아직 `Binance global` 중심이다
- 사용자 입장에서 국내 거래소/원화 기준 감각이 부족하다
- 큐레이션 지갑 카드의 상호작용(필터, drill-down, 관련 트랜잭션 보기)은 아직 문서 대비 초기 단계다

## 6.2 Data / Pipeline 관점

좋아진 점:

- Telegram listener 데이터가 파이프라인과 분리되지 않고 합류한다
- brief 저장 구조가 단순 summary 1필드에서 조금 더 의미 있는 contract 로 확장됐다

남은 점:

- `BriefRecord v2` 수준의 freshness/partial failure 모델은 아직 아니다
- 거래소 시그널의 `exchange × asset × direction × quote_basis` 를 UI가 충분히 소비하지 못한다
- 큐레이션 관련 스키마는 아직 설계 문서 수준이다

## 6.3 Frontend 관점

좋아진 점:

- 사용자 홈이 서브에이전트 산출물을 한 화면에 묶어내기 시작했다
- `/insights -> /` 리다이렉트, `/admin` 분리가 현재 정보 구조와 잘 맞는다
- 타입/린트/빌드가 모두 통과한다

남은 점:

- 티커는 실시간 느낌을 주지만 아직 차트/김프/국내시장 정보가 없다
- `watchlist`/`stories` 가 새 데이터 계층을 쓰긴 하지만, 운영자 편집 플로우는 미연결이다

## 6.4 Ops / Security 관점

좋아진 점:

- 운영 API에서 raw error message 직접 노출은 완화됐다
- listener 상태 추론이 이전보다 실운영에 가깝다

남은 점:

- `/admin` 및 운영 API 보호가 fail-open 성격을 가진다
- 큐레이션 상태가 메모리 저장이라 재기동 안전성이 없다

---

## 7. 권장 다음 실행순서

문서와 현재 구현 상태를 종합하면, 다음 순서가 가장 합리적이다.

1. **운영 보호 계층 정리**
   - `/admin`, `/api/*` 를 fail-closed 로 전환
   - `DASHBOARD_PASSWORD` 미설정 시 운영 환경 차단

2. **큐레이션 지갑 영속화**
   - Google Sheets 에 `curated_wallets`, `wallet_aliases`, `wallet_activity_snapshots` 탭 추가
   - 현재 seed/Map 기반 로직 제거

3. **티커 2단계 확장**
   - Upbit KRW ticker 추가
   - USDT/KRW 및 김치 프리미엄 계산 추가
   - 티커 클릭 시 mini chart 또는 drawer 추가

4. **브리핑 freshness 모델 도입**
   - latest/fallback/stale state 분리
   - 실패/부분성공/지연을 사용자 문구로 구분

5. **고래 스토리 고도화**
   - 주소별 활동 snapshot 기반 스토리 생성
   - 단순 recent tx 템플릿을 넘어 연속 행동 narrative 로 확장

---

## 8. 현재 판단

이번 작업은 "문서대로 완성" 단계는 아니지만, **문서의 방향이 화면과 파이프라인에 실제로 닿기 시작한 기준점**으로 볼 수 있다.

특히 의미 있는 진전은 다음 3가지다.

- 사용자 홈과 운영 화면의 정보 구조가 더 이상 뒤섞이지 않음
- Telegram listener 데이터가 파이프라인에서 고립되지 않음
- 사용자 홈의 핵심 섹션이 임시 더미 조합이 아니라 별도 데이터 계층을 바라보기 시작함

다음 단계의 핵심은 UI가 아니라 **영속 저장과 운영 보안**이다.


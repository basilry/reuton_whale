---
date: 2026-04-18
sequence: 11
tags:
  - whalescope
---

# 2026-04-18-11 WhaleScope 유저홈 v3 구현·QA·코드리뷰 종합보고서

## 1. 기준 문서
- 기준 개선안: `2026-04-18-WhaleScope-유저홈-v3-종합개선안-실시간티커-뉴스-큐레이션.md`
- 이번 패스의 목표: v3 문서의 W1 블로커와 W2 안전 구간을 우선 반영하고, 남은 W3/W4 범위는 후속 작업으로 분리한다.

## 2. 이번 반영 범위 요약
이번 구현에서 실제 반영한 축은 4가지다.

1. 운영 API 인증 fail-close 적용
2. 텔레그램 QR 외부 의존 제거
3. 큐레이션 감시지갑의 Sheets 기반 영속화 기초 도입
4. 유저홈 실시간 티커를 Binance USD + Upbit KRW + 김치 프리미엄 구조로 확장

## 3. 반영 상세

### 3.1 운영 API 인증 fail-close
대상 파일
- `apps/dashboard/lib/auth.ts`
- `apps/dashboard/README.md`

반영 내용
- `NODE_ENV=production` 환경에서 `DASHBOARD_PASSWORD`가 없으면 운영 API가 더 이상 열리지 않도록 변경했다.
- 응답은 `401`이며 body는 `{"error":"missing-production-password"}` 로 통일했다.
- 로컬 개발에서는 기존처럼 비설정 상태를 허용한다.

효과
- Vercel 운영 환경에서 비밀번호 누락 시 API가 열려 버리는 실패 모드를 제거했다.

### 3.2 텔레그램 QR 내부화
대상 파일
- `apps/dashboard/lib/public-app-config.ts`
- `apps/dashboard/app/api/qr/route.ts`
- `apps/dashboard/components/telegram-connect-modal.tsx`
- `apps/dashboard/README.md`

반영 내용
- `api.qrserver.com` 외부 서비스 의존을 제거했다.
- 대시보드 내부 `GET /api/qr?data=...` 라우트가 SVG QR을 직접 생성하도록 변경했다.
- 유저홈 Telegram 모달 문구도 내부 QR 경로 기준으로 정리했다.

효과
- 외부 장애나 정책 변경에 영향을 받지 않고 QR을 안정적으로 제공할 수 있다.
- Vercel 배포 시 외부 추적성도 줄어든다.

### 3.3 큐레이션 감시지갑 Sheets 영속화 기초
대상 파일
- `apps/dashboard/lib/schema.ts`
- `apps/dashboard/lib/sheets.ts`
- `apps/dashboard/lib/curated-wallets.ts`
- `apps/dashboard/lib/metrics.ts`
- `apps/dashboard/app/api/watchlist/route.ts`
- `src/storage/schema.py`
- `apps/dashboard/README.md`

반영 내용
- optional tab으로 아래 스키마를 추가했다.
  - `curated_wallets`
  - `wallet_aliases`
  - `watchlist_overrides`
- 감시지갑 레지스트리는 이제 Sheets 탭이 있으면 해당 데이터를 읽고, 탭이 없으면 기존 seed 데이터를 fallback으로 사용한다.
- watchlist 토글은 더 이상 메모리 `Map`만 바꾸지 않고 `watchlist_overrides`에 append-only 방식으로 기록한다.
- `/api/watchlist`의 응답 형태는 유지했다.
- Python 쪽 `src/storage/schema.py`에도 향후 유저홈/브로드캐스트/스토리 확장을 위한 탭 정의를 추가해 `python -m scripts.init_sheets`가 새 탭을 생성할 수 있게 준비했다.

효과
- Vercel cold start 이후에도 감시지갑 활성/비활성 상태를 유지할 수 있다.
- Sheets 탭이 아직 없는 환경도 깨지지 않고 기존 seed로 정상 동작한다.

### 3.4 실시간 티커 구조 확장
대상 파일
- `apps/dashboard/lib/market-ticker.ts`
- `apps/dashboard/lib/market-fx.ts`
- `apps/dashboard/lib/market-premium.ts`
- `apps/dashboard/components/market-ticker-strip.tsx`
- `apps/dashboard/components/market-ticker-strip.module.css`

반영 내용
- 티커 정의를 Binance USD 심볼 + Upbit KRW 마켓을 함께 가지는 구조로 확장했다.
- REST 초기 스냅샷에서 아래를 함께 읽는다.
  - Binance 24h ticker
  - Upbit KRW ticker
  - USD/KRW 환율
- 실시간 단계에서는 아래를 병행 구독한다.
  - Binance WebSocket
  - Upbit WebSocket
- 카드 표시는 단순 USD 한 줄이 아니라 아래 구조로 바뀌었다.
  - USD 가격
  - KRW 가격
  - USD 24h 변동
  - KRW 24h 변동
  - 김치 프리미엄
- 네트워크가 막힌 경우에는 기존처럼 fallback 예시 시세로 degrade 한다.

효과
- 유저홈 티커가 “실제 한국 사용자 관점”으로 해석 가능한 화면이 되었다.
- 단순 글로벌 USD 가격 나열에서, 국내 KRW 기준과 프리미엄까지 읽는 구조로 진화했다.

## 4. QA 및 빌드 검증
검증 일시
- 2026-04-18

실행한 검증
- `npm run dashboard:typecheck`
- `npm run dashboard:lint`
- `npm run dashboard:build`
- `npm run dashboard:dev`
- `curl -I http://127.0.0.1:3001/`
- `curl -I http://127.0.0.1:3001/admin`
- `curl -I 'http://127.0.0.1:3001/api/qr?data=https%3A%2F%2Ft.me%2Fwhalescope_demo_bot'`
- `curl http://127.0.0.1:3001/api/watchlist`

결과
- `typecheck` 통과
- `lint` 통과
- `build` 통과
- `/` 200 확인
- `/admin` 200 확인
- `/api/qr` 200, `image/svg+xml; charset=utf-8` 확인
- `/api/watchlist` 200, 감시지갑 목록 JSON 응답 확인

확인 메모
- `/api/qr`는 실제 SVG 본문까지 응답했다.
- `/api/watchlist`는 seed fallback 환경에서도 정상 응답했다.

## 5. 다관점 리뷰

### 5.1 Product / UX 관점
좋아진 점
- 유저홈 티커가 한국 사용자 기준으로 읽을 가치가 생겼다.
- Telegram 연결 동선에서 외부 QR 서비스가 사라져 경험이 더 일관적이다.
- 감시지갑 설정이 서버 재시작에 덜 취약해졌다.

아쉬운 점
- v3 문서에서 계획한 뉴스 위젯, 2열 Telegram CTA(개인 봇/공개 채널), 실시간 미니차트는 아직 미반영이다.
- `/admin`과 `/`의 정보 설계는 분리됐지만, 운영자 인증 UX는 아직 없다.

### 5.2 Data / Architecture 관점
좋아진 점
- optional Sheets tab 기반으로 점진 확장이 가능해졌다.
- seed fallback을 유지해 초기 데이터가 없어도 유저홈이 깨지지 않는다.
- 시장 데이터 로직이 `market-fx`, `market-premium`, `market-ticker`로 분리돼 다음 단계 확장이 쉬워졌다.

아쉬운 점
- `watchlist_overrides`는 append-only라 장기 운영 시 row 수가 누적된다.
- `curated_wallets` import 스크립트와 `news_feed` 파이프라인은 아직 없어 실제 운영 데이터 투입은 제한적이다.

### 5.3 Operations / Security 관점
좋아진 점
- 운영 API fail-close는 즉시 의미 있는 보안 개선이다.
- 외부 QR 의존 제거로 운영 불확실성이 줄었다.
- `scripts.init_sheets`가 앞으로 필요한 탭을 더 많이 생성할 수 있는 준비가 됐다.

남은 리스크
- `/admin` 페이지 자체는 아직 별도 인증 UI/세션 없이 서버 컴포넌트에서 직접 데이터를 읽는다. 즉, API만 막고 페이지 자체는 공개 상태일 수 있다. 다음 패치에서 `/admin` 라우트 수준 인증이 필요하다.
- `curated-wallets.ts`의 optional tab read는 현재 광범위한 오류를 fallback으로 삼기 때문에, 실제 Sheets 장애와 “탭 없음”이 같은 동작으로 보일 수 있다. 운영 로그를 남기거나 missing-tab만 구분 처리하는 보강이 필요하다.

### 5.4 Code Quality 관점
좋아진 점
- 타입 경계가 비교적 명확하다.
- build/lint/typecheck가 모두 통과하는 상태로 마감됐다.
- 새 기능이 비교적 작은 모듈로 나뉘어 들어갔다.

주의점
- 내부 QR 생성 라우트는 로직이 길다. 동작은 확인됐지만, 추후 테스트 추가 또는 더 단순한 라이브러리 기반 구현으로 바꿀지 판단이 필요하다.
- `market-ticker-strip`는 상태 관리가 많아져서 이후 미니차트/상세 차트 단계에서는 hook 분리가 필요하다.

## 6. 이번 패스에서 미반영한 v3 항목
아래는 이번에 의도적으로 남긴 범위다.

1. `news_feed` RSS/집계 파이프라인
2. 좌측 사이드바 뉴스 위젯
3. `scripts/import_curated_wallets.py` 기반 대량 지갑 수입
4. `market_snapshots` cron 적재
5. `whale_stories` 탭/API 기반 스토리 영속화
6. `@whalescope_demo_bot` / `@whalescope_alertz` 2열 Telegram CTA
7. broadcast 채널 발행 파이프라인
8. bitFlyer / Kraken 유럽·일본 확장
9. `/admin` 페이지 자체 인증 UX
10. lightweight-charts 기반 미니차트 / 상세차트

## 7. 권장 다음 순서
다음 구현 순서는 아래가 맞다.

1. `/admin` 페이지 인증 마감
2. `scripts/import_curated_wallets.py` + 실제 `curated_wallets` 탭 데이터 적재
3. `news_feed` 파이프라인 + 유저홈 뉴스 위젯
4. Telegram CTA를 봇/공개채널 2열 구조로 확장
5. `market_snapshots` 저장과 브리핑 연계
6. `whale_stories` 영속화와 유저홈 연결
7. 이후에야 미니차트와 bitFlyer/Kraken 확장 진행

## 8. 결론
이번 패스는 v3 문서 전체를 끝낸 것이 아니라, 실제 서비스 안정성과 사용자 해석 가능성을 높이는 핵심 축을 먼저 반영한 단계다.

특히 의미 있는 완료 항목은 다음 셋이다.
- 운영 API fail-close
- 감시지갑 Sheets 영속화 기반 확보
- Binance + Upbit + 김프 구조의 실시간 티커 진입

즉, 유저홈은 이제 단순 데모에서 한 단계 벗어나 실제 서비스형 구조로 이동하기 시작한 상태로 판단한다.

## 9. 2차 추가 반영 (후속 패스)
이번 후속 패스에서는 앞선 보고서의 미반영 항목 중 우선순위가 가장 높았던 두 축을 추가로 반영했다.

1. `/admin` 페이지 자체 인증 UX 및 세션화
2. `Top 10 Liquid Coins` 원본 노트 기반 `curated_wallets` import 스크립트

### 9.1 `/admin` 페이지 인증 UX 마감
대상 파일
- `apps/dashboard/lib/auth.ts`
- `apps/dashboard/app/admin/page.tsx`
- `apps/dashboard/app/api/admin/session/route.ts`
- `apps/dashboard/components/admin-session-panel.tsx`
- `apps/dashboard/components/admin-session-panel.module.css`
- `apps/dashboard/README.md`

반영 내용
- `DASHBOARD_PASSWORD` 기반으로 브라우저 세션 쿠키를 발급하는 `/api/admin/session`을 추가했다.
- 쿠키는 `httpOnly`, `SameSite=Lax`, 12시간 만료 정책을 사용한다.
- `/admin` 페이지는 서버 렌더 이전에 세션 쿠키를 검사한다.
- 동작 모드는 세 가지다.
  - production + 비밀번호 없음: 잠금 패널 표시
  - 비밀번호 설정됨 + 미인증: 로그인 패널 표시
  - 세션 인증됨: 운영 대시보드 표시
- 기존 API 인증은 헤더 방식만 유지하는 것이 아니라, 동일 세션 쿠키도 함께 허용하도록 확장했다.
- 그 결과 브라우저에서 `/admin` 로그인 후 `/api/watchlist`, `/api/signals/*`, `/api/language` 같은 보호 API를 별도 헤더 없이 호출할 수 있다.

효과
- 기존에는 API만 잠겨 있고 `/admin` 페이지는 열릴 수 있는 구조였는데, 이제 페이지 자체도 운영 비밀번호 흐름 안으로 들어왔다.
- 운영자가 브라우저에서 실제로 사용할 수 있는 인증 UX가 생겼다.

### 9.2 `curated_wallets` 실제 import 경로 추가
대상 파일
- `scripts/import_curated_wallets.py`
- `src/storage/sheets_client.py`

반영 내용
- 옵시디언 원본 노트 `Top 10 Liquid Coins - Whale Wallets (2026.4 Updated).md`를 파싱해 `curated_wallets` 탭으로 올리는 스크립트를 추가했다.
- `--dry-run`을 지원한다.
- 실제 주소가 없는 placeholder 행, 텍스트-only bullet 섹션, 불명확한 항목은 보수적으로 스킵한다.
- `SheetsClient.upsert_curated_wallets()`를 추가해 재실행 시 insert/update가 가능하도록 했다.
- 반환 카운트는 `inserted`, `updated`, `invalid`로 정리했다.

효과
- 이전에는 `curated_wallets` 스키마만 있었고 실제 데이터 적재 경로가 없었는데, 이제 실제 원천 문서에서 시트까지 이어지는 첫 import 파이프라인이 생겼다.

## 10. 후속 패스 QA

### 10.1 빌드/정적 검증
실행 항목
- `python -m py_compile scripts/import_curated_wallets.py src/storage/sheets_client.py`
- `python scripts/import_curated_wallets.py --dry-run`
- `npm run dashboard:typecheck`
- `npm run dashboard:lint`
- `npm run dashboard:build`

결과
- Python compile 통과
- import dry-run 통과
- `dashboard:typecheck` 통과
- `dashboard:lint` 통과
- `dashboard:build` 통과

### 10.2 import dry-run 결과
결과 요약
- `Top 10 Liquid Coins` 원본에서 **21개 주소 기반 row**를 파싱했다.
- BTC, ETH, SOL, DOGE 섹션의 실제 주소가 우선 적재 대상이 되었다.
- `0x...` 같은 placeholder, 주소가 없는 bullet 섹션, 텍스트-only 설명은 의도적으로 제외됐다.

판단
- 지금 단계에서는 “많이 넣는 것”보다 “틀리지 않게 넣는 것”이 더 중요하다.
- 따라서 coverage보다 신뢰도를 우선한 현재 파서 정책이 맞다.

### 10.3 `/admin` 세션 인증 런타임 검증
추가 검증 방식
- 임시 dev 서버를 `DASHBOARD_PASSWORD=test123`로 별도 기동해 세션 로그인 플로우를 확인했다.

검증 항목
- `/admin` 최초 접근 시 로그인 패널 표시 확인
- `POST /api/admin/session` with wrong password → `401 unauthorized`
- `POST /api/admin/session` with correct password → `200 ok` + `Set-Cookie`
- 동일 세션 쿠키로 `/admin` 재요청 → 로그인 패널이 아닌 운영 화면 표시 확인
- 동일 세션 쿠키로 `/api/watchlist` 요청 → `200` JSON 응답 확인
- `DELETE /api/admin/session` → `200 ok` + 쿠키 제거 `Set-Cookie`

추가 메모
- 현재 기본 로컬 env에는 `DASHBOARD_PASSWORD`가 없어서, 기본 dev 서버에서는 `/api/admin/session`이 `password-not-configured`를 반환하는 것도 함께 확인했다.

## 11. 후속 패스 코드리뷰 메모

### 11.1 좋아진 점
- `/admin` 보안 경계가 이제 페이지와 API 모두에서 일관되게 작동한다.
- 세션 쿠키를 도입했지만 새로운 외부 auth provider를 들이지 않아 구조 복잡도가 낮다.
- `curated_wallets`는 더 이상 설계 문서상의 테이블이 아니라, 실제로 채울 수 있는 ingestion 입구를 갖게 됐다.

### 11.2 남은 주의점
- 세션 토큰은 password-derived HMAC 기반의 경량 세션이다. MVP에는 충분하지만, 장기적으로는 rotation이나 별도 server secret 도입 여지가 있다.
- `import_curated_wallets.py`는 현재 `curated_wallets`만 다룬다. `wallet_aliases`까지 채우는 2차 정규화는 후속 작업이다.
- import dry-run만 실행했고, 실제 Google Sheets 쓰기 실행은 이번 패스에서 의도적으로 하지 않았다. 외부 데이터 변경은 사용자가 원하는 타이밍에 한 번 더 확인하고 실행하는 편이 안전하다.

## 12. 우선순위 재정렬
이번 후속 패스를 반영하면 다음 순서는 아래처럼 좁혀진다.

1. `scripts/import_curated_wallets.py` 실제 실행으로 `curated_wallets` 탭 채우기
2. `news_feed` 수집 파이프라인 + 유저홈 뉴스 위젯
3. Telegram 봇/공개채널 2열 CTA
4. `market_snapshots` 적재와 브리핑 연계
5. `whale_stories` 영속화
6. 이후 미니차트와 해외 거래소 확장

즉, 보안 경계와 감시지갑 적재 경로는 이제 준비가 끝났고, 다음 단계는 실제 콘텐츠를 늘리는 쪽으로 넘어갈 수 있다.

## 13. 3차 추가 반영 (유저홈 v3 후속 패스)
이번 3차 후속 패스에서는 v3 문서의 W2, W3 일부를 실제 사용자 화면과 파이프라인 기초에 연결했다. 핵심은 “보이도록 만들기”와 “운영 가능한 기초 계층을 넣기” 두 가지다.

반영한 축은 5가지다.
1. 유저홈 티커 카드에 상시 미니 차트와 확장 상세 차트 추가
2. 좌측 사이드바 하단 News Widget과 `/api/news` 공개 API 추가
3. RSS 기반 `news_feed` 수집 스크립트 추가
4. 공개 채널 브로드캐스트 기초 계층 추가
5. 텔레그램 연결 모달을 개인 봇 / 공개 채널 2축 구조로 확장

### 13.1 티커 미니 차트 / 상세 차트 반영
대상 파일
- `apps/dashboard/components/market-mini-chart.tsx`
- `apps/dashboard/components/market-mini-chart.module.css`
- `apps/dashboard/components/market-detail-chart.tsx`
- `apps/dashboard/components/market-detail-chart.module.css`
- `apps/dashboard/components/market-ticker-strip.tsx`
- `apps/dashboard/components/market-ticker-strip.module.css`
- `apps/dashboard/lib/market-ticker.ts`

반영 내용
- `lightweight-charts` 기반 상시 미니 차트를 티커 카드마다 붙였다.
- 카드 하단에 `차트 보기` 토글을 추가해 1m/5m/1h/1d 범위의 상세 차트를 열 수 있게 했다.
- 차트 데이터는 Binance / Upbit 히스토리 fetch를 우선 사용하고, 실패 시 로컬 fallback series로 degrade 한다.
- 런타임 안정화를 위해 두 번의 후속 수정도 포함했다.
  - CSS 토큰의 `oklch(...)`를 차트 라이브러리에 직접 넘기지 않고 `rgb/rgba`로 정규화
  - 초(second) 단위 중복 타임스탬프를 차트 입력 직전에 제거

효과
- 사용자가 지적했던 “티커에 그래프가 안 보인다”는 핵심 갭을 닫았다.
- 미니 차트는 항상 보이고, 상세 차트는 클릭 시 확장되는 구조라 v3 문서의 가시성과 정보량 요구를 함께 맞췄다.

### 13.2 News Widget / `/api/news` / 사이드바 통합
대상 파일
- `apps/dashboard/components/news-widget.tsx`
- `apps/dashboard/components/news-widget.module.css`
- `apps/dashboard/app/api/news/route.ts`
- `apps/dashboard/lib/news.ts`
- `apps/dashboard/app/page.tsx`
- `apps/dashboard/components/insights-sidebar.tsx`
- `apps/dashboard/components/insights-sidebar.module.css`
- `apps/dashboard/lib/schema.ts`

반영 내용
- `news_feed` 탭이 있으면 그것을 우선 사용하고, 비어 있으면 `daily_brief`와 `signals`로 파생 뉴스 카드들을 생성한다.
- `/api/news?limit=...` 공개 API를 추가했고, 기존 대시보드 패턴에 맞춰 캐시/레이트리밋/일반화된 오류 응답을 적용했다.
- 서버 컴포넌트 `NewsWidget`을 만들고, 유저홈 좌측 사이드바 하단 footer slot에 통합했다.
- 실제 시트에 뉴스가 아직 없어도 “빈 패널”이 아니라 사람이 읽을 수 있는 브리핑/시그널 맥락으로 대체되게 했다.

효과
- v3 문서에서 계획한 “좌측 하단 뉴스 위젯”의 정보 구조가 실제 화면에 반영됐다.
- 수집 데이터가 비어 있어도 사용자는 현재 상태를 이해할 수 있다.

### 13.3 RSS 수집 경로 추가
대상 파일
- `src/ingestion/news_rss.py`
- `src/storage/sheets_client.py`

반영 내용
- CoinDesk, Cointelegraph, Decrypt 공개 RSS를 수집해 `news_feed` 탭으로 append하는 ingestion 스크립트를 추가했다.
- HTML 제거, 길이 제한, 발행시각 정규화, source/title/url/published_at/hash 정리를 포함한다.
- `SheetsClient.append_news_feed()`를 추가해 실제 적재 경로를 닫았다.

효과
- 뉴스 위젯이 설계 문서상 위젯이 아니라 실제 데이터 파이프라인 입구를 갖게 됐다.
- 아직 cron은 붙이지 않았지만, 수동 실행 가능한 첫 ingest 경로는 마련됐다.

### 13.4 공개 채널 브로드캐스트 기초 계층
대상 파일
- `src/notify/telegram_broadcast.py`
- `src/config.py`
- `src/main.py`
- `src/storage/sheets_client.py`
- `.env.example`
- `README.md`

반영 내용
- `@whalescope_alertz`를 대상으로 하는 공개 채널 브로드캐스트 어댑터를 추가했다.
- 상태값은 `skipped_disabled`, `skipped_unconfigured`, `dry_run`, `sent`, `failed`로 구분한다.
- 기본값은 `TELEGRAM_BROADCAST_ENABLED=false`, `TELEGRAM_BROADCAST_DRY_RUN=true`라서 안전하게 fail-safe다.
- 일일 브리프 생성 후 공개 채널 브로드캐스트를 별도 경로로 시도하되, 실패해도 전체 파이프라인은 hard-fail하지 않는다.
- 결과는 가능하면 `broadcast_log` 탭에 남긴다.

효과
- 공개 채널 발행은 아직 운영 활성화 전이지만, 프로덕션 전환 시 필요한 최소 백엔드 기초는 준비됐다.
- 사용자용 채널 CTA와 실제 발행 경로가 이제 같은 방향을 보게 됐다.

### 13.5 Telegram CTA 2축 확장
대상 파일
- `apps/dashboard/lib/public-app-config.ts`
- `apps/dashboard/components/telegram-connect-modal.tsx`
- `apps/dashboard/components/telegram-connect-modal.module.css`

반영 내용
- 기존 단일 봇 연결 모달을 “개인 알림 봇”과 “공개 브리핑 채널” 2열 구조로 확장했다.
- `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`과 `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL`을 각각 받아 봇/채널 URL과 QR을 따로 생성한다.
- 링크 복사도 봇/채널 각각 따로 처리한다.

효과
- 1:1 개인화 알림과 1:다 공개 브리핑의 역할 분리가 사용자 UI에도 반영됐다.

## 14. 3차 QA / 검증 결과
검증 일시
- 2026-04-18

실행한 검증
- `npm run dashboard:typecheck`
- `npm run dashboard:lint`
- `npm run dashboard:build`
- `python -m py_compile src/config.py src/main.py src/notify/telegram_broadcast.py src/storage/sheets_client.py src/ingestion/news_rss.py`
- `pytest tests/test_storage_new_tabs.py -q`
- 로컬 dev 서버 기동 후 `GET /` 확인
- 로컬 dev 서버 기동 후 `GET /api/news?limit=3` 확인

결과
- `dashboard:typecheck` 통과
- `dashboard:lint` 통과
- `dashboard:build` 통과
- Python compile 통과
- `tests/test_storage_new_tabs.py` 통과 (`29 passed`)
- `/` 200 확인
- `/api/news?limit=3` 200 확인
- `/` 응답 HTML에서 News Widget 서버 렌더링 확인

추가 메모
- 차트 런타임 관련 후속 수정도 이 패스 안에서 닫았다.
  - `37b3a1d fix: normalize chart colors for lightweight charts`
  - `f9713a8 fix: convert oklch chart tokens to rgb`
  - `20bc7b0 fix: dedupe chart points by second`
- Next.js는 루트 lockfile / 앱 lockfile 이중 존재에 대한 경고를 띄우지만, 현재 빌드 실패 원인은 아니다.

## 15. 코드리뷰 / 다관점 재평가

### 15.1 Product / UX 관점
좋아진 점
- 사용자가 즉시 체감하는 두 빈 공간, 즉 “그래프 없음”과 “뉴스 없음”을 해소했다.
- Telegram 연결이 이제 봇 / 공개 채널의 역할 분리를 사용자에게 명확히 보여준다.
- 데이터가 비어도 빈 카드 대신 이해 가능한 문장으로 대체하는 전략이 유지됐다.

남은 과제
- News Widget은 현재 사이드바 하단에 들어가지만, source가 실제 `news_feed` 행보다 `derived` fallback일 가능성이 높다. 운영 단계에서는 실제 RSS 적재가 더 중요하다.
- 상세 차트는 기능은 들어갔지만, 이후 실제 디자인 QA에서 여백/모바일 상호작용 점검이 한 번 더 필요하다.

### 15.2 Data / Architecture 관점
좋아진 점
- 뉴스 수집, 뉴스 API, 홈 UI가 한 줄로 이어졌다.
- 브로드캐스트는 dry-run 기본이라 운영 안전성이 높다.
- 차트는 데이터 레이어와 UI 레이어가 분리되어 추후 bitFlyer/Kraken 확장도 상대적으로 쉽다.

남은 과제
- `news_rss.py`는 수동 실행 스크립트일 뿐 아직 cron/worker에 연결되지 않았다.
- `broadcast_log`는 적재 경로가 생겼지만, 실제 채널 발행 운영 검증은 아직 안 했다.
- `tests/test_storage.py::TestSchema::test_all_tabs_count`는 탭 수 기대값이 오래돼 별도 정리가 필요하다.

### 15.3 Operations / Reliability 관점
좋아진 점
- 차트 런타임 장애 두 건을 실제 증상 기반으로 바로 닫았다.
  - `oklch` 색 파싱 실패
  - 중복 초 단위 타임스탬프 assertion 실패
- 즉, 현재 유저홈 티커 차트는 “보이는 상태”를 넘어서 기본적인 런타임 안정화까지 들어갔다.

남은 과제
- 실제 배포 환경에서 `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL` 등 공개 env가 빠지면 채널 CTA는 degraded 상태로 보일 수 있다.
- Render/Vercel 배포 후 브라우저 실환경 검증이 한 번 더 필요하다.

## 16. 현재 남은 태스크 재평가
결론부터 말하면, **지금 즉시 막고 있는 블로킹 태스크는 없다.**
이번 패스까지 포함하면 사용자 화면 기준의 주요 런타임 오류는 닫혔고, `main`도 최신 상태다.

다만 v3 문서 기준의 백로그는 아직 남아 있다.

우선순위 높은 잔여 태스크
1. `news_rss.py`를 실제 스케줄러/워커에 연결해 `news_feed`를 주기적으로 채우기
2. `TELEGRAM_BROADCAST_ENABLED=true` 전환 전, 공개 채널 dry-run → 실발행 운영 검증
3. `market_snapshots` 적재와 브리핑/홈 연계
4. `CryptoPanic` 및 추가 뉴스 소스 확장
5. `bitFlyer` / `Kraken` 등 일본·유럽 거래소 확장
6. `whale_stories` 영속화 및 v3 기획 수준의 스토리 정교화
7. `wallet_aliases` 자동 수입/정규화 보강
8. 오래된 스키마 테스트(`tests/test_storage.py`) 기대값 업데이트

판단
- 지금 단계는 “런타임 복구 + 화면 가시화 + 파이프라인 기초 연결”까지 끝난 상태다.
- 다음 단계는 장애 수정이 아니라 **운영 자동화와 데이터 밀도 증가** 쪽으로 넘어가면 된다.

## 17. 종합 결론
현재 `main` 기준 WhaleScope 유저홈은 다음 수준까지 도달했다.

- Upbit KRW / Binance USD / 김치 프리미엄 / 미니 차트 / 상세 차트를 갖춘 사용자용 시장 티커
- 봇과 공개 채널을 분리한 Telegram 연결 UX
- 실제 `news_feed` 파이프라인 입구와 `/api/news` 및 사이드바 News Widget
- 공개 채널 브로드캐스트의 fail-safe 기초 계층
- 차트 관련 런타임 오류 2건까지 수정 완료

즉, 이제 남은 일은 “왜 안 뜨나 / 왜 깨지나”가 아니라, “실제 운영 데이터가 계속 흐르도록 자동화하고 소스를 늘리는 것”이다.

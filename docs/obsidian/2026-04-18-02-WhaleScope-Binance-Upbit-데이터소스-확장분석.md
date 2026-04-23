---
date: 2026-04-18
sequence: 2
project: WhaleScope
repo: /Users/basilry/Projects/02015_reuton_whale
type: data-source-expansion-analysis
assignment: Wrtn Technologies Product Engineer 과제 전형
tags:
  - WhaleScope
  - Binance
  - Upbit
  - market-data
  - signal-quality
related:
  - "[[2026-04-18-09-WhaleScope-페이지-정보구조-운영-사용자-분리-보고서]]"
---

# WhaleScope Binance/Upbit 데이터 소스 확장 분석

## 0. 결론

Binance와 Upbit 데이터는 현재 WhaleScope의 가장 약한 지점인 "고래 이동 이후 시장 반응"을 보완하는 데 유효하다.

현재 데이터 원천:

| 원천 | 현재 역할 | 한계 |
|---|---|---|
| Etherscan | Ethereum 감시 주소 온체인 이동 | 시장 반응을 직접 설명하지 못함 |
| Solscan | Solana 감시 주소 온체인 이동 | 시장 반응을 직접 설명하지 못함 |
| Telegram whale alert | 외부 알림 교차검증 | 텍스트/채널 의존, 노이즈 가능 |
| CoinGecko/PriceService | 가격 보강 | 거래소별 유동성/체결 압력 부족 |

추가할 데이터:

| 원천 | 추가 가치 |
|---|---|
| Binance | 글로벌 USDT 마켓의 체결/호가/24h 거래량 컨텍스트 |
| Upbit | 한국 사용자 관점에서 KRW 마켓 수급/호가/체결 컨텍스트 |

MVP는 candle보다 `ticker + orderbook + recent trades`가 우선이다.

## 1. 왜 필요한가

현재 WhaleScope는 "고래가 움직였다"는 사실과 "이 움직임이 규칙상 중요하다"는 판단은 할 수 있다. 그러나 사용자가 실제로 궁금해하는 다음 질문에는 약하다.

- 이 이동이 시장에서 흡수 가능한 규모인가?
- 거래소 호가가 얇아서 가격 충격 가능성이 큰가?
- 이벤트 이후 매수/매도 체결 압력이 어느 쪽으로 기울었는가?
- 글로벌 시장과 한국 원화 시장의 반응이 다른가?

Binance/Upbit를 넣으면 브리핑이 다음처럼 바뀐다.

```text
Before:
ETH 대량 이동이 감지되었습니다.

After:
ETH 대량 이동이 감지되었고, Binance ETHUSDT 호가 스프레드는 안정적이지만 최근 체결은 매도 우위입니다.
Upbit KRW-ETH에서는 24h 거래대금 대비 이벤트 규모가 작아 단기 충격은 제한적입니다.
```

## 2. 공식 API 기준 확인

### 2.1 Binance

Binance Spot Market Data endpoints는 다음 데이터를 제공한다.

- Order book: `GET /api/v3/depth`
- Recent trades: `GET /api/v3/trades`
- Aggregate trades: `GET /api/v3/aggTrades`
- Kline/Candlestick: `GET /api/v3/klines`
- 24hr ticker: `GET /api/v3/ticker/24hr`
- Rolling window ticker: `GET /api/v3/ticker`
- Symbol price ticker: `GET /api/v3/ticker/price`

공식 문서:

- https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints

### 2.2 Upbit

Upbit Quotation API는 다음 시장 데이터를 제공한다.

- Trading pairs
- Candles/OHLCV
- Recent trades
- Tickers
- Orderbook

공식 문서:

- 글로벌 문서: https://global-docs.upbit.com/docs/upbit-quotation-restful-api
- 한국어 개발자 센터: https://docs.upbit.com/docs
- 한국어 REST best practice: https://docs.upbit.com/kr/docs/rest-api-best-practice
- 한국어 호가 조회: https://docs.upbit.com/kr/reference/%ED%98%B8%EA%B0%80-%EC%A0%95%EB%B3%B4-%EC%A1%B0%ED%9A%8C

한국 사용자 대상 제품이라면 Upbit는 `https://api.upbit.com` 기반 KRW market을 우선 검토하는 것이 맞다.

## 3. 데이터별 우선순위

### 3.1 1순위: Ticker/24h stats

목적:

- whale 이동 금액을 거래소의 24h 거래대금 대비로 정규화한다.
- "큰 이동"이 실제 시장 규모 대비 얼마나 큰지 설명한다.

추천 필드:

| 필드 | 설명 |
|---|---|
| `venue` | `binance`, `upbit` |
| `symbol` | `BTC`, `ETH`, `SOL` |
| `market` | `BTCUSDT`, `KRW-BTC` |
| `price` | 최신 가격 |
| `change_24h` | 24h 등락률 |
| `volume_24h_base` | base asset 거래량 |
| `volume_24h_quote` | quote currency 거래대금 |
| `captured_at` | 수집 시각 |

브리핑 적용:

```text
이번 BTC 이동 규모는 Binance BTCUSDT 24시간 거래대금 대비 약 X% 수준입니다.
```

### 3.2 2순위: Orderbook

목적:

- 유동성, 스프레드, 얇은 호가 여부를 확인한다.
- CEX 유입/유출 신호가 실제 단기 가격 충격으로 이어질 가능성을 보완한다.

추천 필드:

| 필드 | 설명 |
|---|---|
| `best_bid` | 최우선 매수호가 |
| `best_ask` | 최우선 매도호가 |
| `spread_pct` | `(ask - bid) / mid` |
| `bid_depth_usd` | 상위 N호가 매수 유동성 |
| `ask_depth_usd` | 상위 N호가 매도 유동성 |
| `bid_ask_imbalance` | `(bid_depth - ask_depth) / (bid_depth + ask_depth)` |

브리핑 적용:

```text
호가 스프레드가 넓고 ask depth가 얇아, 대규모 시장가 매수/매도에 가격이 민감할 수 있습니다.
```

### 3.3 3순위: Recent trades

목적:

- 이벤트 직후 체결 방향성을 본다.
- whale 이동이 거래소 유입이면 매도 압력, 유출이면 보관/축적 가능성이라는 해석을 보조한다.

추천 필드:

| 필드 | 설명 |
|---|---|
| `trade_count` | 최근 체결 개수 |
| `buy_volume` | 매수 주도 체결량 |
| `sell_volume` | 매도 주도 체결량 |
| `trade_imbalance` | `(buy - sell) / total` |
| `window_seconds` | 집계 창 |

브리핑 적용:

```text
최근 5분 체결은 매도 우위라, CEX 유입 신호와 함께 단기 리스크로 해석할 수 있습니다.
```

### 3.4 4순위: Candles/OHLCV

목적:

- 가격 추세와 변동성을 후행적으로 확인한다.

판단:

- 이미 가격 보강 경로가 있으므로 MVP 1순위는 아니다.
- 시그널 품질을 바로 올리는 것은 orderbook/trades 쪽이 더 크다.

## 4. 아키텍처 설계안

### 4.1 신규 모듈

```text
src/ingestion/binance.py
src/ingestion/upbit.py
src/ingestion/exchange_models.py
```

역할:

- `BinanceMarketCollector`
  - `fetch_ticker(symbols)`
  - `fetch_orderbook(symbol, limit)`
  - `fetch_recent_trades(symbol, limit)`

- `UpbitMarketCollector`
  - `fetch_ticker(markets)`
  - `fetch_orderbook(markets, count)`
  - `fetch_recent_trades(market, count)`

- `exchange_models.py`
  - `MarketSnapshot`
  - `OrderbookSnapshot`
  - `TradeImbalance`

### 4.2 Pipeline 삽입 위치

현재 `src/main.py` 흐름에서 Stage 3와 Stage 5 사이가 적절하다.

```text
Stage 3: raw_events 수집
Stage 4: 가격/소유자 enrich
Stage 4.5: 관련 symbol 추출 후 exchange market snapshot 수집
Stage 5: SignalEngine 실행
Stage 6: LLM daily brief 생성
```

이유:

- 수집된 이벤트에서 symbol을 먼저 알아야 exchange query 범위를 줄일 수 있다.
- exchange snapshot을 SignalEngine context에 주입하면 rule scoring에 바로 반영할 수 있다.

### 4.3 Google Sheets 신규 탭

추천 탭:

```text
exchange_market_snapshots
```

추천 schema:

| 컬럼 | 설명 |
|---|---|
| `snapshot_id` | unique id |
| `captured_at` | 수집 시각 |
| `venue` | `binance`, `upbit` |
| `symbol` | `BTC`, `ETH`, `SOL` |
| `market` | `BTCUSDT`, `KRW-BTC` |
| `price` | 최신 가격 |
| `change_24h` | 24h 등락률 |
| `volume_24h_quote` | quote 기준 24h 거래대금 |
| `best_bid` | 최우선 매수호가 |
| `best_ask` | 최우선 매도호가 |
| `spread_pct` | 스프레드 |
| `bid_depth_quote` | 상위 N호가 매수 유동성 |
| `ask_depth_quote` | 상위 N호가 매도 유동성 |
| `bid_ask_imbalance` | 호가 불균형 |
| `trade_imbalance` | 최근 체결 방향 |
| `window_seconds` | 집계 창 |
| `source_id` | 관련 signal_id 또는 run_id |

### 4.4 SignalEngine 확장

`RuleContext`에 다음 필드를 추가한다.

```python
market_snapshots: dict[str, list[MarketSnapshot]]
venue_stats: dict[str, VenueStats]
```

추가 가능한 rule:

| rule | 설명 |
|---|---|
| `exchange_liquidity_thin` | 고래 이동 규모 대비 orderbook depth가 얇을 때 |
| `cex_inflow_sell_pressure` | CEX 유입 + recent trades 매도 우위 |
| `cex_outflow_accumulation_confirmed` | CEX 유출 + 매도 압력 감소 |
| `korea_premium_reaction` | Upbit KRW market 반응과 Binance USDT market 반응 괴리 |

## 5. 사용자 브리핑 반영 방식

### 5.1 사용자에게 보여줄 문장

원시 JSON 대신 다음처럼 해석한다.

```text
ETH 고래 이동은 온체인 기준으로 거래소 유입에 가깝습니다.
Binance ETHUSDT에서는 최근 체결이 매도 우위로 기울었고, Upbit KRW-ETH는 호가 스프레드가 안정적입니다.
따라서 단기 급락보다는 변동성 확대 가능성을 우선 관찰하는 편이 좋습니다.
```

### 5.2 운영자에게 보여줄 지표

`/admin`에는 다음을 보여줄 수 있다.

- exchange snapshot freshness
- API error count
- venue별 수집 성공/실패
- symbol mapping 실패 목록
- orderbook/trade 데이터 수집 latency

## 6. 구현 순서

### Phase 1. 공개 REST ticker 수집

목표:

- Binance `ticker/24hr`, Upbit `ticker`를 가져와 Sheets에 저장한다.

완료 기준:

- `exchange_market_snapshots` 탭 생성
- `BTC`, `ETH`, `SOL`, `USDT/USDC` 대상 price/volume 저장
- pipeline 1회 실행에서 snapshot row 확인

### Phase 2. Orderbook 수집

목표:

- 최우선 호가, spread, 상위 N호가 depth, imbalance 계산.

완료 기준:

- `spread_pct`, `bid_depth_quote`, `ask_depth_quote`, `bid_ask_imbalance` 저장
- CEX 유입/유출 시그널 브리핑에 liquidity 문장 1개 추가

### Phase 3. Recent trades imbalance

목표:

- 최근 100~200개 체결을 바탕으로 buy/sell imbalance 계산.

완료 기준:

- `trade_imbalance`, `window_seconds` 저장
- 단기 매수/매도 압력 문장 생성

### Phase 4. SignalEngine 통합

목표:

- exchange snapshot을 rule context에 주입하고 신규 rule 추가.

완료 기준:

- 신규 rule 최소 2개
- 테스트 fixture 추가
- 기존 온체인-only 신호와 exchange-enhanced 신호가 구분됨

### Phase 5. Dashboard 반영

목표:

- 사용자 홈에는 문장형 시장 반응을 표시하고, `/admin`에는 수집 상태와 실패 로그를 표시.

완료 기준:

- 사용자 화면에 raw JSON이 아니라 "시장 반응 문장" 표시
- 운영 화면에 venue freshness 표시

## 7. 위험과 대응

| 위험 | 설명 | 대응 |
|---|---|---|
| API rate limit | Binance/Upbit public REST 호출 과다 | signal에 등장한 symbol만 조회, 캐시/주기 제한 |
| symbol mapping | `ETH` -> `ETHUSDT`, `KRW-ETH` 매핑 필요 | mapping table 또는 설정 파일 추가 |
| 노이즈 증가 | 시장 데이터가 너무 많으면 브리핑이 산만해짐 | LLM 입력은 요약된 market features만 전달 |
| 운영 비용 | 호출량 증가와 저장 row 증가 | Google Sheets row 관리와 snapshot TTL 필요 |
| 과제 범위 초과 | 제출 전 구현 범위가 커짐 | 제출 전에는 분석 문서까지만, 구현은 제출 후 Phase F로 둠 |

## 8. MVP 판단

과제 제출 전이라면 지금 당장 Binance/Upbit 구현까지 넣는 것은 범위가 커질 수 있다. 하지만 문서화와 설계 근거는 매우 좋다.

추천:

1. 제출 전에는 "현재 한계와 확장 계획"으로 보고서에 남긴다.
2. 제출 이후 첫 개선으로 `ticker + orderbook`만 추가한다.
3. `recent trades`와 신규 rule은 두 번째 개선으로 둔다.
4. candle/OHLCV는 가장 마지막에 둔다.

## 9. 최종 제안

Binance/Upbit는 단순히 가격을 더 가져오기 위한 소스가 아니다. WhaleScope의 제품 가치를 "고래 이동 요약"에서 "고래 이동이 시장에서 어떻게 흡수되는지 설명"으로 확장하는 소스다.

따라서 구현 우선순위는 다음이 맞다.

```text
ticker/24h stats -> orderbook depth/spread -> recent trades imbalance -> SignalEngine rule 통합 -> dashboard 문장화
```

이 순서가 가장 작은 구현으로 사용자 체감 품질을 올린다.

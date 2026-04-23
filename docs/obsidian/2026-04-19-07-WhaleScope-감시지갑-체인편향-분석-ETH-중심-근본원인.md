---
type: analysis
project: WhaleScope
date: 2026-04-19
sequence: 7
status: report
version: v1
tags:
  - WhaleScope
  - watched-addresses
  - chain-coverage
  - BTC
  - XRP
  - DOGE
  - SOL
  - root-cause
related:
  - "[[2026-04-18-03-WhaleScope-감시지갑-큐레이션-고래스토리-기획]]"
  - "[[2026-04-18-02-WhaleScope-Binance-Upbit-데이터소스-확장분석]]"
  - "[[Top 10 Liquid Coins - Whale Wallets (2026.4 Updated)]]"
  - "[[2026-04-19-06-WhaleScope-운영페이지-관측-개선계획-v2-Render-로그-통합-상세설계]]"
---

# 감시지갑이 ETH에만 몰려 있는 이유 — 근본 원인 분석 보고서

## 0. 요약 (TL;DR)

현재 `config/watched_addresses.csv`(구글시트 `watched_addresses` 탭의 시드 소스) 에 등록된 **감시지갑 81개 중 ETH 78개(96.3%) · SOL 2개(2.5%) · 그 외(BTC·XRP·DOGE·TRX·BNB) 0개**다. 이는 **큐레이션의 취향 문제가 아니라 수집 파이프라인의 기술적 제약이 그대로 반영된 결과**다.

핵심 원인 세 가지:

1. **엔진이 account-based 체인만 읽는다.** `src/ingestion/` 아래 수집기는 `etherscan.py`(EVM 5종)와 `solscan.py`(Solana) 두 개뿐이다. BTC/DOGE(UTXO), XRP(XRPL), TRX(Tron), TON 전용 수집기가 없다.
2. **파이프라인 분기 자체가 2갈래만 존재한다.** `src/pipeline/common.py`의 `collect_recent_events`는 `EVM_CHAINS = ("ETH","ARB","BASE","BSC","POLYGON")` 루프 + `chain == "SOL"` 필터 두 분기밖에 없다. 어떤 주소를 시트에 추가해도 이 두 분기 밖이면 **무시된다(조용히 드롭)**.
3. **"고래 이동" 신호를 주소 팔로잉으로 잡는 전략 자체가 UTXO·뱅크-of-주소 체인과 맞지 않다.** BTC/DOGE cold wallet은 수십만 개 주소 클러스터로 운영되며, 대표 주소 1~2개를 감시해도 "빙산의 일각"만 관측된다. XRP는 escrow 릴리스 스케줄이 공개돼 있어 수신 주소 감시로는 이벤트성 정보가 적다.

즉, **"왜 ETH 뿐인가"의 정답은 "Etherscan+Solscan 엔진으로 돌아가는 account-model-only 파이프라인이기 때문"이다.** 다른 체인을 추가하려면 주소를 늘리는 게 아니라 **수집기·노멀라이저·시그널 룰을 새로 쓰는 것**이 선결 작업이다.

---

## 1. 현황 증거 — 숫자와 코드로 확인

### 1.1 감시지갑 체인 분포

`config/watched_addresses.csv`(헤더 포함 82줄, 데이터 81건):

| chain | 개수 | 비중 | category 내역 |
|---|---:|---:|---|
| ETH | 78 | 96.3% | cex 30 / smart_money 20 / token_whale 18 / bridge 10 |
| SOL | 2 | 2.5% | token_whale 2 (SOL Whale 1/2) |
| BTC | 0 | 0% | — |
| XRP | 0 | 0% | — |
| DOGE | 0 | 0% | — |
| TRX | 0 | 0% | — |
| BNB (네이티브) | 0 | 0% | — |
| **합계** | **80**\* | | |

\* 정확히는 81행 중 일부가 `bridge` 카테고리로 ETH L1 컨트랙트(Arbitrum Bridge, Base Portal, Optimism Portal 등)임. 즉 "ETH 네트워크 위의 L2 브리지 컨트랙트"이지 Arbitrum/Base 체인 자체 주소는 아니다. **실측하면 100% Ethereum L1 + 2개 Solana**.

### 1.2 수집기 소스 코드 — 2종뿐

```
src/ingestion/
├── etherscan.py         # EVM 5종 (ETH/ARB/BASE/BSC/POLYGON)
├── solscan.py           # Solana only
├── news_rss.py          # RSS (온체인 아님)
├── telethon_listener.py # Telegram (외부 알림)
├── tg_normalizer.py     # TG → 표준 이벤트 정규화
├── normalizer.py        # 체인 트랜잭션 → Event 변환
└── curated_balance_refresh.py
```

`etherscan.py`의 지원 체인:

```python
_CHAIN_IDS = {
    "ETH": 1, "ARB": 42161, "BASE": 8453,
    "BSC": 56, "POLYGON": 137,  # 모두 EVM
}
```

`solscan.py`는 `https://public-api.solscan.io/v2/account/transactions` 한 엔드포인트에 의존.

**BTC/DOGE/XRP/TRX/TON 수집기는 존재하지 않는다.**

### 1.3 파이프라인 분기 — 2갈래

`src/pipeline/common.py` L298~331:

```python
watched_index = sheets.list_watched_addresses()

if eth_collector is not None:
    for chain in EVM_CHAINS:   # ("ETH","ARB","BASE","BSC","POLYGON")
        addrs = [addr for addr, row in watched_index.items()
                 if row.get("chain", "").upper() in (chain, "EVM", "")]
        ...
        raw_events.extend(eth_collector.fetch(addrs, chain, ...))

if sol_collector is not None:
    sol_addrs = [addr for addr, row in watched_index.items()
                 if row.get("chain", "").upper() == "SOL"]
    if sol_addrs:
        raw_events.extend(sol_collector.fetch(sol_addrs, ...))
```

주목:
- `chain == "BTC"` 분기 **없음**.
- 디폴트 분기도 `EVM_CHAINS` 안이면 흡수, 밖이면 **조용히 skip**.
- 즉, 누군가 시트에 `chain=BTC` 행을 추가해도 `watched_index`에 로드는 되지만 수집 단계에서 **어디에도 디스패치되지 않고 드롭**된다. 경고 로그조차 없다.

### 1.4 환경 변수 제약

`load_pipeline_env`에서 ETHERSCAN_API_KEY는 필수(`require_chain_api=True`일 때), SOLSCAN_API_KEY는 옵셔널(무료 티어 허용). **BTC/XRP/DOGE 관련 API 키 슬롯 자체가 없다** (`render.yaml` 기준).

### 1.5 기 조사된 BTC/XRP/DOGE 지갑 — 리서치만 됐고 투입 안 됨

옵시디언 `Top 10 Liquid Coins - Whale Wallets (2026.4 Updated).md` 에는:
- BTC: Binance/Robinhood/Bitfinex/Tether cold 주소 10건
- XRP: Ripple escrow, Chris Larsen, Binance/Upbit 주소 10건
- DOGE: Robinhood/Binance/Upbit cold 주소 5건
- SOL: top holder 10건

이 **이미 수집되어 있다**. 즉 큐레이션 소스는 있으되 **파이프라인이 이를 받아들일 경로가 없어 투입되지 못하고 있다**.

---

## 2. 근본 원인 — 왜 이렇게 됐나

### 2.1 설계 관점 — "account-based 첫 설계"의 관성

WhaleScope의 최초 시그널 모델은 "주소가 주소로 전송"을 기본 단위로 한다. 이 모델은:

| 체인 | account 모델? | 주소 기반 트랜잭션 리스트 조회 | 팔로잉 난이도 |
|---|---|---|---|
| Ethereum + EVM 계열 | ✅ | Etherscan `txlist` 한 번 호출 | 쉬움 |
| Solana | ✅ (유사) | Solscan `account/transactions` 한 번 | 쉬움 |
| **Bitcoin / Dogecoin** | ❌ (**UTXO**) | 주소 히스토리 인덱서 필요 (mempool, blockchair, BlockCypher) | 중~어려움 |
| **XRP Ledger** | ✅ (account) 이지만 별도 RPC | XRPL WebSocket/JSON-RPC, XRPSCAN 필요 | 중간 |
| **Tron** | ✅ (account) 이지만 별도 API | TronGrid, TronScan 필요 | 중간 |
| TON | ✅ 유사 | TonAPI, Toncenter 필요 | 중간 |

Etherscan + Solscan 두 곳으로 MVP를 시작했고, 그 관성이 1년간 이어졌다. 이는 **합리적 선택**이었다 — EVM에서만 해도 의미 있는 고래 이동이 충분히 많고, 파이프라인이 안정화될 때까지 체인 수를 늘리지 않는 것이 맞다. 다만 "대중 인지 BTC/XRP/DOGE가 빠져 있다"는 제품 리스크는 쌓여 있었다.

### 2.2 데이터 소스 경제성 관점

비용·가용성·유지보수를 비교하면 ETH/SOL에 먼저 투자한 이유가 명확하다.

| 체인 | 대표 API | 무료 티어 | 안정성 | 코인 포지션 |
|---|---|---|---|---|
| Ethereum | Etherscan v2 (멀티체인) | 5 req/s, 100k/day | ⭐⭐⭐⭐⭐ | DeFi/스테이블/스마트머니 密集 |
| Solana | Solscan Public v2 | IP rate limit | ⭐⭐⭐⭐ | memecoin·고빈도 |
| Bitcoin | Blockchair / mempool.space / BlockCypher | 각기 다름(분당 수십) | ⭐⭐⭐ (복수 리전 필요) | "가격 반응"은 크지만 주소 팔로잉 정보량은 낮음 |
| XRP | XRPSCAN, ripple-data-api | 제한적 | ⭐⭐⭐ | Ripple escrow 이벤트가 스케줄 공개 |
| Dogecoin | Blockchair, dogechain.info | 제한적 | ⭐⭐ | 중앙화 거래소 cold 중심 |
| Tron | TronGrid | 무료 | ⭐⭐⭐⭐ | USDT 트래픽이 크지만 "고래 행동" 해석은 어려움 |

엔지니어링 관점에서 "**Etherscan 하나로 EVM 5체인 + DeFi + 스테이블 + 브리지 + smart_money 를 한 번에 커버**"는 ROI가 매우 높다. BTC 하나 붙이려면 인덱서 선정·페이징·재시도·가격 매핑 등 별도 작업이 필요한데 결과적으로 얻는 "고래 이동 이벤트 수"는 ETH 대비 적다.

### 2.3 신호(Signal) 경제성 관점

`config/signals.yaml`의 규칙 7종은 **account 모델 전제로 설계**되어 있다:

- `cex_inflow_spike`, `cex_outflow_spike` — 특정 주소(CEX hot/cold)로 들어오고 나가는 플로우
- `cold_to_hot_transfer` — 같은 entity의 cold → hot 이동
- `smart_money_accumulation` — 특정 주소들의 합계 매수 추세
- `token_whale_concentration_shift` — top N 주소 집중도
- `corroborated_move` — 온체인과 TG 알림 간의 매칭

이 모든 규칙이 **"주소 = 정체(identity)"** 가정에 의존한다. BTC/DOGE는 주소 재사용이 권장되지 않는 UTXO 지갑이라 **한 entity가 수만~수십만 주소를 쓴다**. "Binance BTC cold #1" 주소 하나만 감시해서는 Binance의 실제 BTC 플로우 중 **아주 일부만** 잡힌다. 정확히 관측하려면 **address clustering**(동일 소유주 주소 묶음)이 필수인데 이는 별도 인프라다.

즉, **BTC를 ETH 수준의 해상도로 관측하려면 파이프라인이 거의 한 배 더 커져야 한다.**

### 2.4 제품 UX 관점 — 사용자 인식과의 괴리

한편 사용자 관점에서는 **BTC/XRP/DOGE가 없다는 사실 자체가 가장 먼저 눈에 띈다**. 이유:

- 한국 사용자의 KRW 시장 거래대금은 BTC·XRP·DOGE가 상위권이다.
- 텔레그램 whale alert 채널(이미 우리가 `tg_whale_events`로 수신 중)은 BTC/XRP 이벤트를 매일 다수 배포한다.
- "고래"라는 단어가 은유적으로 **BTC와 가장 강하게 결합**되어 있다("Satoshi 이동" 등).

따라서 "엔진이 BTC를 읽지 않는다"는 사실은 **내부 기술 제약**이지만, 대외적으로는 **"이 제품은 BTC를 안 다룬다"로 읽힌다**. 이 간극이 현 구조의 핵심 리스크다.

### 2.5 이미 있는 부분적 BTC/XRP/DOGE 경로 — TG 리스너 및 가격

불완전하지만 **완전히 백지는 아니다**. 현재 파이프라인 내부에서 BTC/XRP/DOGE가 닿는 경로:

1. **Telegram listener** (`src/ingestion/telethon_listener.py`) 정규식에 `bitcoin|ethereum|tron|stellar|solana|polygon|ripple|eos|cardano|bsc|bnb` 포함 — **외부 whale alert 채널에서 오는 BTC/XRP 이벤트는 수신된다**. 다만 이것은 "외부가 이야기한 이벤트"를 옮겨 적는 것일 뿐, **우리가 직접 온체인을 읽는 게 아니다**. `tg_whale_events` 탭에 기록은 남지만 `corroborated_move` 규칙으로 교차 검증할 on-chain 파트너가 없어 **낮은 severity로만** 노출된다.
2. **CoinGecko price collector** (`src/collectors/coingecko.py`)는 BTC/XRP/DOGE/BCH 가격을 이미 매핑해 둔다. 즉 **가격 층은 준비됐고 온체인 관측 층만 비어 있다**.
3. **Telegram bot** `/watchlist ETH BTC SOL` 사용자 명령을 받는 스텁이 존재 — **사용자는 BTC를 요청할 수 있지만 엔진이 그 요청에 응할 수 없다**.

이는 체인 확장이 "파이프라인 완전 리빌드"가 아니라 **특정 지점(수집기 1개 + 라우팅 분기 1개)만 추가**하면 된다는 걸 의미한다.

---

## 3. 왜 "시트에 주소만 추가"는 해결이 아닌가 — 침묵의 실패

시트에 `0x...,BTC,cex,Binance BTC Cold,...` 한 줄 추가하면 어떻게 되는가?

1. `sheets.list_watched_addresses()`가 그 행을 `watched_index`에 포함시킨다.
2. `eth_collector.fetch`에 들어갈 때 `EVM_CHAINS` 루프를 돈다 → `chain.upper() in (chain, "EVM", "")` 조건에서 "BTC"는 어떤 EVM 체인과도 매칭 안 됨 → **skip**.
3. `sol_collector.fetch` 루프 → `chain == "SOL"` 아님 → **skip**.
4. `collect_recent_events`가 완료되고 해당 주소의 이벤트는 **0건**으로 집계된다.
5. **경고 로그 없음, 에러 없음, 메트릭 없음.** 운영자는 "주소를 추가했는데 왜 아무 이벤트도 안 뜨지?" 상태로 방치된다.

이 "침묵의 실패(silent drop)"는 다음 의미를 가진다:

- **UI/UX 블라인드 스팟**: 관리자는 시트에 추가 → 다음 런이 돌면 카드에 잡히겠거니 기대하지만, 영원히 안 잡힌다.
- **관측성 부채**: `service_health`에 `unsupported_chain_skipped=N` 같은 카운터가 없다. 즉 v2 운영 페이지 개선(문서 #24)에서 `cross-layer correlation`을 강화할 때 이 누락을 감지할 트리거가 필요하다.
- **큐레이션 기획 문서(#18)의 `chain` enum과의 불일치**: 기획 문서는 `"bitcoin"|"ethereum"|"tron"|"solana"|...` 를 스키마에 올렸지만, 런타임은 실질적으로 `"ethereum"|"solana"|(그 외 skip)`이다.

이 갭 자체가 다음 백로그 아이템이 되어야 한다.

---

## 4. 다관점 진단

### 4.1 엔지니어링 관점

- **설계 건전성**: 현재 구조는 "수집기 1개 = 체인 1개" 암묵적 컨벤션을 따르는데, EVM은 하나의 Etherscan으로 5체인 → 일관성이 깨진다. 추상화를 다시 하면 `ChainCollector` 인터페이스 + 구현체별 dispatcher로 정리할 여지가 있다.
- **침묵 실패 부재한 가드**: 지원되지 않는 chain은 `logger.warning(...)` 이상으로 `system_log` 또는 `service_health.unsupported_chain_count`에 기록되어야 한다.
- **BTC 인덱서 선택지 R&D 필요**: mempool.space는 무료지만 rate limit이 낮다. Blockchair는 유료 티어가 저렴($10/월 ~). QuickNode/Alchemy는 다체인이지만 BTC는 Bitcoin-only 별도 Tier.

### 4.2 제품/PM 관점

- **"고래 제품"인데 BTC가 없다**는 것은 심사위원/사용자 첫인상에서 치명적인 **기본기 질문**을 만든다. Wrtn 과제 전형 문서(`2026-04-18-WhaleScope-Binance-Upbit-데이터소스-확장분석.md`) 관점에서 "BTC/XRP를 읽는가?"는 **0/1 평가 항목**이 될 가능성이 높다.
- ETF·Ripple·거래소 헤드라인은 BTC·XRP에 집중 → **브리핑 품질을 올리려면 이 체인이 필수**.
- 한국 사용자 Upbit 거래 상위가 BTC/XRP/DOGE → **로컬 시장 공감대에 가장 큰 레버**.

### 4.3 마케팅/스토리텔링 관점

- BTC/XRP/DOGE 지갑이 없으면 **"고래 스토리 엔진"의 템플릿 다양성**이 절반으로 떨어진다. 예컨대 `activation`(장기 휴면 지갑 기동) 템플릿은 BTC Mt.Gox 추정 주소나 Satoshi 계열이 가장 극적인 사례다. ETH에는 그런 "10년 휴면" 서사가 상대적으로 적다.
- **Ripple escrow 월별 릴리스**는 스케줄이 공개되어 있어 **예고형 스토리**(예: "내일 Ripple escrow에서 N억 XRP가 풀립니다") 카피가 가능. 이건 ETH/SOL에서 만들 수 없는 서사다.

### 4.4 리스크/컴플라이언스 관점

- BTC 주소 추적은 Chainalysis-like 제재 목록 주소 매칭 리스크가 증가한다(특히 믹서/OFAC). 기획 문서(#18)의 `mixer_or_sanctioned` 카테고리는 **BTC 추가 시 즉시 의미를 가진다** — 정책 가이드 필요.
- XRP는 Ripple-SEC 판결 후 제품 카피의 법적 리스크가 낮아졌지만, "Jed McCaleb 잔량 이동" 같은 이벤트는 **특정 개인 명예와 연결**되어 grade C 추정을 A로 잘못 보여주면 리스크.

### 4.5 비용 관점

- 체인 추가당 API 비용(추정 월 USD):
  - BTC via mempool.space 자체호스팅 → $0 인프라 제외 시 **실질 $20~50/월** (VPS + 풀노드 200GB 스토리지 제외하면 블록체어 $10 티어)
  - XRP via XRPSCAN 무료 → **$0**
  - DOGE via Blockchair 무료 티어 혹은 $10 티어 → **$0~10**
  - Tron via TronGrid 무료 → **$0**
- 즉 **금전 비용은 합쳐도 월 $30~60 이내**. 병목은 비용이 아니라 **엔지니어링 공수**다.

---

## 5. "그럼 어떻게 할 것인가" — 우선순위별 제안

### 5.1 즉시 반영 (공수 ≤ 2시간, v2.1 후보)

**P0-1. Silent drop 가드 추가**
```python
# src/pipeline/common.py collect_recent_events 말미에
supported = set(EVM_CHAINS) | {"SOL", "EVM", ""}
unsupported = [row.get("chain","").upper()
               for row in watched_index.values()
               if row.get("chain","").upper() not in supported]
if unsupported:
    from collections import Counter
    logger.warning("Unsupported chains skipped: %s", dict(Counter(unsupported)))
    errors.append(f"unsupported_chains={Counter(unsupported)}")
```
→ v2 운영 페이지의 `service_health.notes` 혹은 `system_log`에 노출되도록.

**P0-2. README / 운영 문서에 "현재 지원 체인: ETH(+EVM 4종), SOL 2체인" 명시**
- 시트 `watched_addresses` 탭 헤더 주석에 `chain: 현재 지원 값 ETH|ARB|BASE|BSC|POLYGON|SOL. 그 외는 수집되지 않습니다.` 추가.

### 5.2 Phase 1 — TG 미러링으로 1차 해갈 (공수 1~2일)

**P1. TG whale alert의 BTC/XRP/DOGE 이벤트를 "관측은 없지만 중계는 됨" 배지로 UI에 노출**
- 이미 `tg_whale_events` 탭에 들어오는 중. `corroborated_move`가 불가능하므로 severity는 낮게.
- 카드 UI에 `외부 관측 기반` 배지 + 원천(채널명) 표기.
- 장점: **엔진을 건드리지 않고** 제품 인상을 즉시 개선. "BTC 이벤트가 아예 안 보인다"는 문제를 부분적으로 해결.
- 단점: 우리가 직접 읽는 게 아니므로 신호 품질 한계.

### 5.3 Phase 2 — XRP/TRX 추가 (공수 3~5일)

**P2-1. XRP 수집기 (`src/ingestion/xrpl.py`)**
- 데이터 소스: XRPSCAN 공개 API or `s1.ripple.com` JSON-RPC (`account_tx` 메서드)
- 이유: account model로 ETH 패턴과 거의 동일. 학습곡선 낮음.
- 시드 주소: Ripple escrow 2~3개, Chris Larsen, Binance/Upbit (기 리서치됨)

**P2-2. Tron 수집기 (`src/ingestion/tron.py`)**
- 데이터 소스: TronGrid `/v1/accounts/{addr}/transactions`
- 이유: USDT 트래픽의 60%가 Tron에 있음 → **스테이블 플로우 신호 대폭 강화**.

**P2-3. `EVM_CHAINS` 대신 `SUPPORTED_CHAINS` 레지스트리로 일반화**
```python
COLLECTORS: dict[str, Collector] = {
    "ETH": eth_collector, "ARB": eth_collector, "BASE": eth_collector,
    "BSC": eth_collector, "POLYGON": eth_collector,
    "SOL": sol_collector,
    "XRP": xrpl_collector,
    "TRX": tron_collector,
}
for chain, collector in COLLECTORS.items():
    addrs = [...]
    raw_events.extend(collector.fetch(addrs, chain, ...))
```

### 5.4 Phase 3 — BTC/DOGE (공수 1.5~2주)

**P3-1. BTC 수집기 (`src/ingestion/bitcoin.py`)**
- 1차: mempool.space `/api/address/{addr}/txs` (무료·안정·rate limit 있음)
- 2차: Blockchair API ($10/월) — 캐시·다중 주소 배치 호출로 rate 완화
- 정규화: UTXO 모델이라 **inflow/outflow를 수신 주소 합계로 재계산** 필요. `normalize_chain_tx`에 `chain == "BTC"` 분기 추가.
- 주소 선택: **개별 주소 10개로는 빙산 관측**이라는 한계를 인정하고, "대표 주소 + entity 라벨"로 **이벤트 노출의 `is_partial_view=true` 플래그** 도입.

**P3-2. DOGE 수집기**
- Blockchair `/bitcoin/dogecoin` 패밀리. BTC와 구조 동일.
- DOGE 고래는 Binance/Upbit/Robinhood cold 중심 → 주소 5~10개로 "**거래소 플로우**"만 추적해도 제품 가치 충분.

**P3-3. UTXO cluster 경량화**
- Phase 3에서는 하드코딩된 "entity → [대표 주소 N개]" 매핑을 운용.
- Phase 4에서 OXT.me 또는 자체 휴리스틱으로 `cluster_id` 부여 고려.

### 5.5 Phase 4 — 품질·시그널 확장 (공수 지속)

- `cex_inflow_spike` 등 룰이 체인별 임계값을 가질 수 있도록 `signals.yaml`에 `per_chain_overrides` 지원 (BTC는 $1M 임계가 너무 낮을 수 있음 → $5M 등).
- 기획 문서 #18의 `curated_wallets` 테이블화 + 본 분석의 체인 확장 결과를 **하나의 1급 레지스트리**로 통합.
- v2 운영 페이지(#24)의 데이터 층 카드에 **체인별 관측 건수 + 지원 체인 갯수**를 대시보드화.

---

## 6. "빠르게 눈속임"과 "제대로 고치기" — 트레이드오프

| 옵션 | 공수 | 사용자 인식 변화 | 기술 부채 |
|---|---|---|---|
| (A) 시트에 BTC 주소만 먼저 추가 | 10분 | **없음** (silent drop) | 오히려 증가 — 혼란 |
| (B) TG mirroring으로 BTC 이벤트 카드 노출 | 4시간 | "BTC가 보인다" 인식 획득 | 낮음 |
| (C) XRP 수집기 추가 | 2일 | BTC는 여전히 없지만 확장 신호 | 낮음 |
| (D) BTC 본격 수집기 추가 | 1.5주 | **근본 해결** | 상쇄 (레지스트리 정리 포함 시 오히려 감소) |

권장 경로: **A는 금지**(silent drop 유발). **B 먼저 반영 → C 병행 → D는 다음 스프린트**. B는 엔진 리빌드 없이 사용자 인식을 즉시 바꿀 수 있어 ROI가 가장 높다.

---

## 7. 오픈 이슈·결정 필요 항목

1. **BTC UTXO 관측의 해상도 기준**: "주소 1~2개 = 빙산"을 인정하고 `is_partial_view` 배지로 UX에 드러낼 것인가, 아니면 cluster 작업이 끝날 때까지 BTC 출시를 보류할 것인가. 제품 전략 결정.
2. **체인 확장 순서**: 시장 점유율 우선(BTC → XRP → DOGE)인가, 엔지니어링 ROI 우선(XRP → TRX → BTC → DOGE)인가.
3. **`curated_wallets` 마이그레이션 타이밍**: 체인 확장을 현재 `watched_addresses.csv`에 계속 얹을지, #18 기획대로 `curated_wallets` 테이블로 먼저 전환하고 그 위에서 체인 확장할지. 후자가 정석이지만 공수 +1주.
4. **OFAC/제재 주소 정책**: BTC 추가 시 가장 먼저 부딪히는 카테고리. 노출 여부·배지·필터 기본값 결정 필요.
5. **TG 채널 출처 신뢰도 매트릭스**: P1(TG mirroring) 채택 시 채널별 신뢰도 점수 — Whale Alert, 다른 KOL 채널을 구분 표기할 것인가.

---

## 8. 결론

"왜 ETH 뿐인가"의 답은 **기술 결정 하나로 귀결된다**: 파이프라인이 Etherscan(EVM 5종)과 Solscan(SOL) 두 개의 account-model 수집기 위에 설계되었고, 시그널 룰·노멀라이저·UI 전 구간이 그 전제에 동기화되어 있다. 그래서 **시트에 BTC 주소를 추가해도 엔진이 침묵으로 드롭**한다.

해결 순서는 "주소 추가 → 엔진 확장"이 아니라 **"silent drop 가드 → TG 미러링 UX → XRP/TRX 수집기 → BTC 수집기(+UTXO 클러스터)"** 다. 가장 작은 변화(silent drop 가드)는 2시간 내 가능하고, 가장 큰 변화(BTC 본격 관측)는 1.5~2주 공수다. 이 작업은 `curated_wallets` 기획(#18) · 운영 페이지 v2(#24) 와 교차하므로, **Phase 2 이후 레지스트리 마이그레이션과 함께 묶어 처리하는 것**이 기술 부채를 증가시키지 않는 유일한 길이다.

---

## 부록 A — 체인별 관측 난이도 요약

| 체인 | 모델 | 대표 API | 공수(인시) | 주소 감시 유효성 | 제품 파급 |
|---|---|---|---:|---|---|
| ETH (+ EVM 5종) | account | Etherscan v2 | 0 (이미 구현) | 매우 높음 | — |
| SOL | account 유사 | Solscan | 0 (이미 구현) | 높음 | — |
| XRP | account | XRPSCAN / rippled | 12~16 | 높음 (escrow/거래소) | 중 |
| TRX | account | TronGrid | 8~12 | 중~높음 (USDT 플로우) | 중~높음 |
| TON | account 유사 | TonAPI | 8~12 | 중 | 저 |
| BTC | **UTXO** | mempool.space / Blockchair | 40~60 | **부분** (cluster 필요) | 매우 높음 |
| DOGE | UTXO | Blockchair | 16~24 | 중 (거래소 cold 중심) | 중 |
| BCH/LTC | UTXO | Blockchair | 8~12 | 낮음 (제품 우선순위 낮음) | 저 |

## 부록 B — 현재 감시 주소 카테고리별 샘플 (ETH 쏠림의 구체적 내역)

- cex(30): Binance 1~8, Kraken 1·2·4, Bitfinex 1~3, Gemini 1~3, Coinbase 1~5, Robinhood 1·2, OKX 1·2, Bybit 1·2, Huobi 1, Upbit 1
- smart_money(20): Vitalik 1~3, Wintermute, Jump Crypto, Paradigm 1·2, a16z Crypto, Polychain, Dragonfly, Multicoin, Crypto.com, Celsius, BlockFi, Alameda, FTX, 3AC, FTX US, Delphi Digital, Galaxy Digital
- token_whale(18 ETH + 2 SOL): Tether Treasury, Circle USDC, WETH, ETH2 Deposit, WBTC, USDT Whale 1~3, USDC Whale 1·2, ETH Whale 1~3, WBTC Whale 1·2, Polygon ERC20 Bridge, Uniswap WBTC-ETH, Balancer Vault | SOL Whale 1·2
- bridge(10): Arbitrum/Base/Optimism/Polygon/zkSync Bridges, Across, Hop, Stargate, Celer, Synapse

위 리스트는 **모두 Ethereum L1 주소**다. "bridge" 카테고리도 L1 컨트랙트 주소이지 Arbitrum/Base 체인 자체 트랜잭션이 아니다.

## 부록 C — 파이프라인 변경 최소 패치 스케치 (P0-1)

```python
# src/pipeline/common.py
SUPPORTED_CHAINS = frozenset(EVM_CHAINS + ("SOL", "EVM", ""))

def _warn_unsupported_chains(watched_index: dict) -> list[str]:
    from collections import Counter
    unsupported = Counter(
        (row.get("chain") or "").upper()
        for row in watched_index.values()
        if (row.get("chain") or "").upper() not in SUPPORTED_CHAINS
    )
    if not unsupported:
        return []
    message = ", ".join(f"{k}={v}" for k, v in sorted(unsupported.items()))
    logger.warning("Unsupported chains silently dropped: %s", message)
    return [f"unsupported_chains:{message}"]
```

`collect_recent_events` 진입 직후 이 함수를 호출해 `errors`에 합쳐 올리면 `service_health.notes`와 v2 운영 페이지 B1 카드에 즉시 노출된다.

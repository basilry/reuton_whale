from src.utils.logger import get_logger

logger = get_logger("scoring")


class TransactionScorer:
    MIN_AMOUNT_USD = 1_000_000
    MAX_PRE_FILTER = 30
    TOP_N = 5

    def calculate_base_score(self, transaction: dict) -> float:
        amount_usd = transaction.get("amount_usd", 0)

        if amount_usd > 50_000_000:
            score = 7.0
        elif amount_usd > 10_000_000:
            score = 6.0
        elif amount_usd > 1_000_000:
            score = 5.0
        else:
            score = 3.0

        to_type = transaction.get("to_owner_type", "")
        from_type = transaction.get("from_owner_type", "")

        if to_type == "exchange":
            score += 2
        elif from_type == "exchange":
            score += 1

        if transaction.get("repeat_count", 0) > 1:
            score += 1

        return score

    def pre_filter(self, transactions: list[dict]) -> list[dict]:
        filtered = [tx for tx in transactions if tx.get("amount_usd", 0) >= self.MIN_AMOUNT_USD]

        for tx in filtered:
            tx["base_score"] = self.calculate_base_score(tx)

        exchange_txs = [tx for tx in filtered if tx.get("to_owner_type") == "exchange" or tx.get("from_owner_type") == "exchange"]
        non_exchange = [tx for tx in filtered if tx not in exchange_txs]

        prioritized = exchange_txs + non_exchange
        prioritized.sort(key=lambda x: x.get("base_score", 0), reverse=True)

        result = prioritized[:self.MAX_PRE_FILTER]
        logger.info("Pre-filtered %d -> %d transactions", len(transactions), len(result))
        return result

    def rank_by_importance(self, analyzed: list[dict]) -> list[dict]:
        ranked = sorted(analyzed, key=lambda x: x.get("importance_score", 0), reverse=True)
        return ranked[:self.TOP_N]

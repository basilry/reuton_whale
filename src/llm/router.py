"""LLM router with preferred/fallback model selection."""
from __future__ import annotations

import logging
from typing import Optional

from src.llm.base import LLMProvider, LLMResult
from src.utils.errors import LLMRouterError


class LLMRouter:
    def __init__(
        self,
        providers: dict[str, LLMProvider],
        routing_config: dict,
        logger: Optional[logging.Logger] = None,
    ):
        self.providers = providers
        self.config = routing_config
        self.logger = logger or logging.getLogger(__name__)

    def call_task(self, task: str, system: str, user: str) -> LLMResult:
        task_cfg = self.config["tasks"][task]
        candidates = [task_cfg["preferred"]] + list(task_cfg.get("fallback", []))
        max_tokens = task_cfg.get("max_tokens", 2048)
        last_err: Optional[Exception] = None

        for model_spec in candidates:
            provider_name, model_id = model_spec.split("/", 1)
            provider = self.providers.get(provider_name)
            if provider is None:
                last_err = LLMRouterError(f"Provider {provider_name!r} is not configured")
                self._log(task, model_spec, "error", error=str(last_err))
                continue
            try:
                result = provider.call(system, user, model=model_id, max_tokens=max_tokens)
                self._log(task, model_spec, "ok", result)
                return result
            except Exception as exc:
                last_err = exc
                self._log(task, model_spec, "error", error=str(exc))

        raise LLMRouterError(f"All candidates failed for task {task!r}: {last_err}")

    def _log(
        self,
        task: str,
        model_spec: str,
        status: str,
        result: Optional[LLMResult] = None,
        error: Optional[str] = None,
    ) -> None:
        if status == "ok" and result is not None:
            self.logger.info(
                "llm_router task=%s model=%s status=ok tokens_in=%d tokens_out=%d cost_usd=%.6f latency_ms=%d",
                task,
                model_spec,
                result.tokens_in,
                result.tokens_out,
                result.cost_usd,
                result.latency_ms,
            )
        else:
            self.logger.warning(
                "llm_router task=%s model=%s status=error error=%s",
                task,
                model_spec,
                error,
            )

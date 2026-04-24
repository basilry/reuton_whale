import asyncio
import functools
import random
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

from src.utils.errors import StorageQuotaExceeded
from src.utils.logger import get_logger

logger = get_logger("retry")
T = TypeVar("T")


def retry(
    max_retries: int = 5,
    base_delay: float = 1.0,
    non_retry_exceptions: tuple[type[BaseException], ...] = (StorageQuotaExceeded,),
):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if isinstance(e, non_retry_exceptions):
                        raise
                    last_exception = e
                    if attempt == max_retries:
                        break
                    delay = base_delay * (2 ** attempt) + random.uniform(0, base_delay)
                    logger.warning(
                        "Attempt %d/%d for %s failed: %s. Retrying in %.1fs",
                        attempt + 1,
                        max_retries,
                        func.__name__,
                        e,
                        delay,
                    )
                    time.sleep(delay)
            raise last_exception
        return wrapper
    return decorator


async def async_retry(
    func: Callable[[], Awaitable[T]],
    *,
    max_attempts: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 5.0,
    delay_for_exception: Callable[[Exception, int], float | int] | None = None,
    should_retry: Callable[[Exception], bool] | None = None,
    retry_exceptions: tuple[type[BaseException], ...] = (Exception,),
) -> T:
    last_exception: Exception | None = None

    for attempt in range(1, max_attempts + 1):
        try:
            return await func()
        except Exception as exc:
            if should_retry is not None:
                if not should_retry(exc):
                    raise
            elif not isinstance(exc, retry_exceptions):
                raise

            last_exception = exc
            if attempt >= max_attempts:
                break

            if delay_for_exception is not None:
                delay = delay_for_exception(exc, attempt)
            else:
                delay = min(base_delay * (2 ** (attempt - 1)), max_delay)

            delay = max(0.0, float(delay))
            logger.warning(
                "Attempt %d/%d failed: %s. Retrying in %.1fs",
                attempt,
                max_attempts,
                exc,
                delay,
            )
            await asyncio.sleep(delay)

    if last_exception is None:
        raise RuntimeError("async_retry exhausted without capturing an exception")
    raise last_exception

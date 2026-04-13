import functools
import random
import time

from src.utils.logger import get_logger

logger = get_logger("retry")


def retry(max_retries: int = 5, base_delay: float = 1.0):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
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

from __future__ import annotations

import os
from collections.abc import Mapping

from src.storage.postgres_client import PostgresClient
from src.storage.sheets_client import SheetsClient
from src.utils.errors import StorageError

SUPPORTED_STORAGE_BACKENDS = {"sheets", "postgres"}


def normalize_storage_backend(value: object | None = None) -> str:
    backend = str(value or os.getenv("STORAGE_BACKEND", "sheets")).strip().lower()
    if not backend:
        backend = "sheets"
    if backend not in SUPPORTED_STORAGE_BACKENDS:
        raise StorageError(
            f"Unsupported STORAGE_BACKEND={backend!r}; expected one of: "
            f"{', '.join(sorted(SUPPORTED_STORAGE_BACKENDS))}"
        )
    return backend


def _require_env(environ: Mapping[str, str], name: str) -> str:
    value = environ.get(name, "").strip()
    if not value:
        raise StorageError(f"Missing required environment variable: {name}")
    return value


def build_storage_client(
    *,
    backend: str | None = None,
    environ: Mapping[str, str] | None = None,
):
    env = environ or os.environ
    selected = normalize_storage_backend(backend or env.get("STORAGE_BACKEND", "sheets"))

    if selected == "postgres":
        return PostgresClient(database_url=_require_env(env, "DATABASE_URL"))

    return SheetsClient(
        _require_env(env, "GOOGLE_SHEET_ID"),
        _require_env(env, "GOOGLE_CREDENTIALS_JSON"),
        write_mode=env.get("SHEETS_WRITE_MODE", "full").strip().lower() or "full",
    )

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from src.storage.factory import build_storage_client, normalize_storage_backend
from src.utils.errors import StorageError


def test_normalize_storage_backend_defaults_to_sheets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STORAGE_BACKEND", raising=False)

    assert normalize_storage_backend() == "sheets"


def test_normalize_storage_backend_rejects_unknown() -> None:
    with pytest.raises(StorageError, match="Unsupported STORAGE_BACKEND"):
        normalize_storage_backend("dual")


def test_build_storage_client_uses_sheets_env_names(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORAGE_BACKEND", "sheets")
    monkeypatch.setenv("GOOGLE_SHEET_ID", "sheet-id")
    monkeypatch.setenv("GOOGLE_CREDENTIALS_JSON", '{"type":"service_account"}')
    monkeypatch.setenv("SHEETS_WRITE_MODE", "summary_only")

    with patch("src.storage.factory.SheetsClient") as sheets_cls:
        instance = MagicMock()
        sheets_cls.return_value = instance

        assert build_storage_client() is instance

    sheets_cls.assert_called_once_with(
        "sheet-id",
        '{"type":"service_account"}',
        write_mode="summary_only",
    )


def test_build_storage_client_uses_postgres_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@example.com/db")

    with patch("src.storage.factory.PostgresClient") as postgres_cls:
        instance = MagicMock()
        postgres_cls.return_value = instance

        assert build_storage_client() is instance

    postgres_cls.assert_called_once_with(
        database_url="postgresql://user:pass@example.com/db"
    )


def test_build_storage_client_requires_postgres_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORAGE_BACKEND", "postgres")
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(StorageError, match="DATABASE_URL"):
        build_storage_client()

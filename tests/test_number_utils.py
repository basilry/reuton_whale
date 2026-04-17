"""Tests for src.utils.number_utils.safe_float."""
import logging

import pytest

from src.utils.number_utils import safe_float


class TestSafeFloat:
    def test_parses_numeric_str(self):
        assert safe_float("42") == 42.0

    def test_parses_int(self):
        assert safe_float(7) == 7.0

    def test_strip_commas_option(self):
        assert safe_float("1,012,450", strip_commas=True) == 1_012_450.0

    def test_strip_commas_off_fails_on_comma_str(self, caplog):
        caplog.set_level(logging.DEBUG)
        assert safe_float("1,012,450", strip_commas=False) == 0.0

    def test_none_returns_default(self):
        assert safe_float(None) == 0.0
        assert safe_float(None, default=-1.0) == -1.0

    def test_invalid_str_falls_back(self, caplog):
        test_logger = logging.getLogger("test.safe_float.invalid")
        test_logger.propagate = True
        caplog.set_level(logging.DEBUG, logger=test_logger.name)
        assert (
            safe_float("not-a-number", default=3.14, logger=test_logger) == 3.14
        )
        assert any(
            "safe_float failed" in record.getMessage() for record in caplog.records
        )

    def test_field_name_is_logged(self, caplog):
        test_logger = logging.getLogger("test.safe_float.field")
        test_logger.propagate = True
        caplog.set_level(logging.WARNING, logger=test_logger.name)
        safe_float(
            "bad",
            field_name="amount_usd",
            log_level=logging.WARNING,
            logger=test_logger,
        )
        assert any(
            "field=amount_usd" in record.getMessage() for record in caplog.records
        )

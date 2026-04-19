import requests
import pytest


@pytest.fixture(scope="session")
def contract_session() -> requests.Session:
    session = requests.Session()
    session.headers["User-Agent"] = "whalescope-contract-tests/1.0"
    yield session
    session.close()

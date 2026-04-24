class WhaleAlertError(Exception):
    """Deprecated. Removed in TRACK 3."""
    pass


class AnalysisError(Exception):
    pass


class StorageError(Exception):
    pass


class StorageQuotaExceeded(StorageError):
    pass


class DistributorError(Exception):
    pass


class LLMProviderError(Exception):
    pass


class LLMRouterError(Exception):
    pass


class EtherscanError(Exception):
    pass


class SolscanError(Exception):
    pass


class XrplError(Exception):
    pass


class TronError(Exception):
    pass


class BitcoinError(Exception):
    pass


class DogecoinError(Exception):
    pass


class SignalEngineError(Exception):
    pass

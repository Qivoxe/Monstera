"""Small bounded, instance-local TTL cache. Replaceable by a shared implementation."""
from collections import OrderedDict
from threading import RLock
from time import monotonic
from typing import Any
from app.core.config import get_settings


class TTLCache:
    def __init__(self, max_entries: int = 512):
        self.max_entries = max(1, max_entries)
        self._values: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = RLock()

    def get(self, key: str):
        with self._lock:
            item = self._values.get(key)
            if item is None:
                return None
            expiry, value = item
            if expiry <= monotonic():
                del self._values[key]
                return None
            self._values.move_to_end(key)
            return value

    def set(self, key: str, value: Any, ttl_seconds: int):
        with self._lock:
            self._values[key] = (monotonic() + ttl_seconds, value)
            self._values.move_to_end(key)
            while len(self._values) > self.max_entries:
                self._values.popitem(last=False)

    def clear(self):
        with self._lock:
            self._values.clear()


cache = TTLCache(get_settings().provider_cache_max_entries)

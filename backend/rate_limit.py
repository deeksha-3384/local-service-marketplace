import time
from collections import defaultdict, deque
from threading import Lock

from errors import ApiError

_hits = defaultdict(deque)
_lock = Lock()


def check_rate(key, limit, window_seconds):
    """Sliding-window limiter, per server process. Protects the free AI quota."""
    now = time.monotonic()
    with _lock:
        q = _hits[key]
        while q and now - q[0] > window_seconds:
            q.popleft()
        if len(q) >= limit:
            retry = int(window_seconds - (now - q[0])) + 1
            raise ApiError(
                429, "RATE_LIMITED",
                "Too many requests. Please wait a moment and try again.",
                {"retry_after_seconds": retry},
            )
        q.append(now)
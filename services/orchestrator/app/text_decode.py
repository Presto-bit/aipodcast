from __future__ import annotations

from typing import Any


def safe_decode_bytes(value: Any, *, encoding: str = "utf-8", errors: str = "replace") -> str:
    """
    Safely decode possibly-binary inputs to text without raising UnicodeDecodeError.
    """
    if isinstance(value, bytes):
        return value.decode(encoding, errors=errors)
    if isinstance(value, bytearray):
        return bytes(value).decode(encoding, errors=errors)
    return str(value or "")

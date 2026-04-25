import hashlib
import json
import math
from decimal import Decimal
from typing import Any

from .internal_storage_url import sanitize_job_result_media_urls_for_browser


def _payload_sha256(payload: Any) -> str:
    """对 payload 做稳定哈希；遇不可序列化对象时退化为空对象，避免 JSONResponse 构建失败。"""
    try:
        if payload is None:
            raw = b"{}"
        elif isinstance(payload, dict) and not payload:
            raw = b"{}"
        else:
            raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()
    except (TypeError, ValueError, UnicodeEncodeError):
        return hashlib.sha256(b"{}").hexdigest()


def _coerce_job_result_field(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            j = json.loads(raw)
            return j if isinstance(j, dict) else {}
        except (json.JSONDecodeError, TypeError, ValueError):
            return {}
    return {}


def _normalize_progress(val: Any) -> float:
    try:
        if val is None:
            return 0.0
        if isinstance(val, Decimal):
            n = float(val)
        else:
            n = float(val)
        if not math.isfinite(n):
            return 0.0
        return max(0.0, min(100.0, n))
    except (TypeError, ValueError):
        return 0.0


def serialize_job(row: dict[str, Any] | None) -> dict[str, Any]:
    if not row:
        return {}
    out = dict(row)
    for k in ("id", "project_id", "created_by"):
        if out.get(k) is not None:
            out[k] = str(out[k])
    for k in ("created_at", "started_at", "completed_at", "updated_at"):
        if out.get(k) is not None:
            out[k] = str(out[k])
    if "progress" in out:
        out["progress"] = _normalize_progress(out.get("progress"))
    em = out.get("error_message")
    if em is not None and not isinstance(em, str):
        out["error_message"] = str(em)
    if "result" in out:
        out["result"] = _coerce_job_result_field(out.get("result"))
        if isinstance(out.get("result"), dict):
            sanitize_job_result_media_urls_for_browser(out["result"])
    out["payload_sha256"] = _payload_sha256(out.get("payload"))
    return out

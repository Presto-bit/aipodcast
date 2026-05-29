"""进行中任务 result 增量合并（与终态 merge_job_result 分离）。"""
from __future__ import annotations

import json
from typing import Any

from .models import get_conn, get_cursor


def _coerce_job_result_dict(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return dict(parsed) if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def patch_job_running_result(job_id: str, patch: dict[str, Any]) -> bool:
    """将 patch 浅层合并进 jobs.result（仅 queued/running）。成功返回 True。"""
    jid = (job_id or "").strip()
    if not jid or not patch:
        return False
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("SELECT status, result FROM jobs WHERE id = %s FOR UPDATE", (jid,))
            row = cur.fetchone()
            if not row:
                return False
            st = str(row.get("status") or "")
            if st not in ("queued", "running"):
                return False
            merged = _coerce_job_result_dict(row.get("result"))
            merged.update(patch)
            cur.execute(
                "UPDATE jobs SET result = %s::jsonb, updated_at = NOW() WHERE id = %s",
                (json.dumps(merged, ensure_ascii=False, default=str), jid),
            )
            conn.commit()
    return True

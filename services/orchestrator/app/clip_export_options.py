"""剪辑导出选项：请求体验证与默认值（与前端 export_options 结构对齐）。"""

from __future__ import annotations

from typing import Any


def sanitize_clip_export_options(raw: Any) -> dict[str, Any]:
    """
    将客户端 JSON 规范为安全子集；未知字段丢弃。
    结构：
      encoding: { lame_q: 0-9 }
      loudness: { i_lufs, tp, lra, disabled }
      range: { mode: full|custom, start_ms, end_ms }
      metadata: { title, artist, album, genre, comment }
      advanced: { merge_gap_ms }
    """
    if not isinstance(raw, dict):
        raw = {}
    out: dict[str, Any] = {}

    enc = raw.get("encoding") if isinstance(raw.get("encoding"), dict) else {}
    try:
        q = int(enc.get("lame_q", 2))
        q = max(0, min(9, q))
    except (TypeError, ValueError):
        q = 2
    out["encoding"] = {"lame_q": q}

    loud = raw.get("loudness") if isinstance(raw.get("loudness"), dict) else {}
    try:
        i_lufs = float(loud.get("i_lufs", -16))
        i_lufs = max(-24.0, min(-10.0, i_lufs))
    except (TypeError, ValueError):
        i_lufs = -16.0
    try:
        tp = float(loud.get("tp", -1.5))
        tp = max(-3.0, min(0.0, tp))
    except (TypeError, ValueError):
        tp = -1.5
    try:
        lra = float(loud.get("lra", 11))
        lra = max(1.0, min(20.0, lra))
    except (TypeError, ValueError):
        lra = 11.0
    disabled = bool(loud.get("disabled"))
    out["loudness"] = {"i_lufs": i_lufs, "tp": tp, "lra": lra, "disabled": disabled}

    rng = raw.get("range") if isinstance(raw.get("range"), dict) else {}
    mode = str(rng.get("mode", "full") or "full").lower()
    if mode not in ("full", "custom"):
        mode = "full"
    start_ms: int | None = None
    end_ms: int | None = None
    if mode == "custom":
        try:
            start_ms = max(0, int(rng.get("start_ms", 0)))
        except (TypeError, ValueError):
            start_ms = 0
        try:
            end_ms = int(rng.get("end_ms", 0))
        except (TypeError, ValueError):
            end_ms = 0
        if end_ms <= 0 or start_ms >= end_ms:
            mode = "full"
            start_ms, end_ms = None, None
    else:
        start_ms, end_ms = None, None
    out["range"] = {"mode": mode, "start_ms": start_ms, "end_ms": end_ms}

    meta = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}

    def _s(key: str, maxlen: int = 240) -> str:
        v = meta.get(key)
        if v is None:
            return ""
        return str(v).strip()[:maxlen]

    out["metadata"] = {
        "title": _s("title", 300),
        "artist": _s("artist", 200),
        "album": _s("album", 200),
        "genre": _s("genre", 80),
        "comment": _s("comment", 500),
    }

    adv = raw.get("advanced") if isinstance(raw.get("advanced"), dict) else {}
    try:
        mg = int(adv.get("merge_gap_ms", 120))
        mg = max(0, min(2000, mg))
    except (TypeError, ValueError):
        mg = 120
    out["advanced"] = {"merge_gap_ms": mg}

    return out

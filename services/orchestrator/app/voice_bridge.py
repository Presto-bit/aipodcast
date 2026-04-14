import json
import os
from typing import Any

from app.fyv_shared.config import DEFAULT_VOICES, VOICE_STORE_FILE
from app.fyv_shared.minimax_system_voices_data import SYSTEM_VOICES


def get_default_voices() -> dict[str, Any]:
    return dict(DEFAULT_VOICES or {})


def get_system_voices() -> dict[str, Any]:
    """Minimax 官方系统音色表（与 minimax_system_voices_data 同源）；含 provider / voice_type 供前端展示与筛选。"""
    out: dict[str, Any] = {}
    for k, v in (SYSTEM_VOICES or {}).items():
        if not isinstance(v, dict):
            continue
        item = dict(v)
        item.setdefault("provider", "minimax")
        item.setdefault("voice_type", "系统音色")
        out[str(k)] = item
    return out


def get_saved_voices() -> list[dict[str, Any]]:
    if not os.path.exists(VOICE_STORE_FILE):
        return []
    try:
        with open(VOICE_STORE_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        return []
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        voice_id = str(item.get("voiceId") or "").strip()
        if not voice_id:
            continue
        out.append(
            {
                "voiceId": voice_id,
                "displayName": str(item.get("displayName") or voice_id),
                "createdAt": item.get("createdAt"),
                "lastUsedAt": item.get("lastUsedAt"),
            }
        )
    return out[:200]


def save_saved_voices(voices: list[dict[str, Any]]) -> tuple[bool, str]:
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in voices:
        if not isinstance(item, dict):
            continue
        voice_id = str(item.get("voiceId") or "").strip()
        if not voice_id or voice_id in seen:
            continue
        seen.add(voice_id)
        normalized.append(
            {
                "voiceId": voice_id,
                "displayName": str(item.get("displayName") or voice_id).strip() or voice_id,
                "createdAt": item.get("createdAt"),
                "lastUsedAt": item.get("lastUsedAt"),
            }
        )
    try:
        os.makedirs(os.path.dirname(VOICE_STORE_FILE) or ".", exist_ok=True)
        with open(VOICE_STORE_FILE, "w", encoding="utf-8") as f:
            json.dump(normalized[:200], f, ensure_ascii=False, indent=2)
    except Exception as exc:
        return False, str(exc)
    return True, ""

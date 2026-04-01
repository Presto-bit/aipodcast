from __future__ import annotations

import base64
import json
from typing import Any
from urllib import request


def _http_post_json(url: str, headers: dict[str, str], payload: dict[str, Any], timeout_sec: int = 90) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(url=url, data=data, headers=headers, method="POST")
    with request.urlopen(req, timeout=timeout_sec) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    return json.loads(body)


def _extract_first_text(data: Any, keys: tuple[str, ...]) -> str:
    if isinstance(data, dict):
        for k in keys:
            v = data.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        for v in data.values():
            s = _extract_first_text(v, keys)
            if s:
                return s
    elif isinstance(data, list):
        for item in data:
            s = _extract_first_text(item, keys)
            if s:
                return s
    return ""


def tts_via_http_json(*, url: str, api_key: str, model: str, text: str, voice_id: str) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": model, "text": text, "voice_id": voice_id}
    resp = _http_post_json(url, headers, payload)
    audio_hex = _extract_first_text(resp, ("audio_hex",))
    if not audio_hex:
        audio_b64 = _extract_first_text(resp, ("audio_base64", "audio"))
        if audio_b64:
            audio_hex = base64.b64decode(audio_b64).hex()
    if not audio_hex:
        raise RuntimeError("provider_tts_no_audio")
    return {
        "audio_hex": audio_hex,
        "trace_id": _extract_first_text(resp, ("trace_id", "request_id", "id")),
        "upstream_status_code": None,
        "attempt_errors": [],
        "retries": 0,
    }


def voice_clone_via_http_json(
    *,
    url: str,
    api_key: str,
    model: str,
    audio_b64: str,
    filename: str,
    display_name: str | None,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "audio_base64": audio_b64,
        "filename": filename,
        "display_name": display_name or "",
    }
    resp = _http_post_json(url, headers, payload)
    voice_id = _extract_first_text(resp, ("voice_id", "speaker_id"))
    if not voice_id:
        raise RuntimeError("provider_clone_no_voice_id")
    return {
        "voice_id": voice_id,
        "upload_trace_id": _extract_first_text(resp, ("upload_trace_id", "request_id", "id")),
        "clone_trace_id": _extract_first_text(resp, ("clone_trace_id", "request_id", "id")),
        "message": "音色克隆成功",
    }


def image_via_http_json(*, url: str, api_key: str, model: str, prompt: str) -> tuple[str | None, str | None]:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": model, "prompt": prompt}
    resp = _http_post_json(url, headers, payload)
    image_url = _extract_first_text(resp, ("image_url", "url"))
    if image_url:
        return image_url, None
    return None, "provider_image_no_url"


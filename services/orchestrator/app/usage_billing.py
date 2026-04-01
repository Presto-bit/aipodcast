"""
MiniMax 按量计费参考：https://platform.minimaxi.com/docs/guides/pricing-paygo
估算仅用于后台用量看板；实际消耗以 MiniMax 控制台为准。
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

ZH_RE = re.compile(r"[\u4e00-\u9fff]")


def _parse_jsonish(val: Any) -> dict[str, Any]:
    if val is None:
        return {}
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        try:
            out = json.loads(val)
            return out if isinstance(out, dict) else {}
        except Exception:
            return {}
    return {}


def minimax_billing_chars(text: str) -> int:
    """语音计费字符：1 汉字=2，其余（字母、标点、空格等）=1。"""
    n = 0
    for ch in text or "":
        if ZH_RE.match(ch):
            n += 2
        else:
            n += 1
    return n


def text_model_pricing_per_million_tokens(
    model_id: str,
) -> tuple[float, float, float | None, float | None]:
    """
    返回 (input_cny_per_mtok, output_cny_per_mtok, cache_read_cny_per_mtok|None, cache_write_cny_per_mtok|None)。
    命名与官网表格对齐；未收录的预览版模型按 M2.7 标准档估算。
    """
    k = (model_id or "").strip().lower().replace(" ", "").replace("_", "-")

    def m27_hs() -> tuple[float, float, float | None, float | None]:
        return (4.2, 16.8, 0.42, 2.625)

    def m27() -> tuple[float, float, float | None, float | None]:
        return (2.1, 8.4, 0.42, 2.625)

    def m25_hs() -> tuple[float, float, float | None, float | None]:
        return (4.2, 16.8, 0.21, 2.625)

    def m25() -> tuple[float, float, float | None, float | None]:
        return (2.1, 8.4, 0.21, 2.625)

    def m21_hs() -> tuple[float, float, float | None, float | None]:
        return (4.2, 16.8, 0.21, 2.625)

    def m21() -> tuple[float, float, float | None, float | None]:
        return (2.1, 8.4, 0.21, 2.625)

    def m2() -> tuple[float, float, float | None, float | None]:
        return (2.1, 8.4, 0.21, 2.625)

    def m2_her() -> tuple[float, float, float | None, float | None]:
        return (2.1, 8.4, None, None)

    if "m2-her" in k or "m2her" in k or "m2_her" in k:
        return m2_her()
    if "m2.7" in k or "m2-7" in k:
        return m27_hs() if "highspeed" in k or "high-speed" in k else m27()
    if "m2.5" in k or "m2-5" in k:
        return m25_hs() if "highspeed" in k or "high-speed" in k else m25()
    if "m2.1" in k or "m2-1" in k:
        return m21_hs() if "highspeed" in k or "high-speed" in k else m21()
    if "preview" in k:
        return m27()
    if ("minimax-m2" in k or k == "m2") and not any(
        x in k for x in ("m2.7", "m2-7", "m2.5", "m2-5", "m2.1", "m2-1")
    ):
        return m2()
    if "m2" in k:
        return m27()
    return m27()


def estimate_tokens_from_chars_zh_heuristic(char_count: int) -> float:
    """官网：1600 中文字符约 1000 tokens（中英混合时作近似）。"""
    if char_count <= 0:
        return 0.0
    return float(char_count) * (1000.0 / 1600.0)


def estimate_llm_cost_cny(
    *,
    text_model: str,
    prompt_chars: int,
    completion_chars: int,
) -> float:
    inp_t = estimate_tokens_from_chars_zh_heuristic(prompt_chars)
    out_t = estimate_tokens_from_chars_zh_heuristic(completion_chars)
    pi, po, _, _ = text_model_pricing_per_million_tokens(text_model)
    return round((inp_t / 1_000_000.0) * pi + (out_t / 1_000_000.0) * po, 6)


def tts_price_cny_per_10k_billing_chars(tts_model: str) -> float:
    """T2A：HD 3.5 元/万字符；turbo 2 元/万字符（speech-2.8-hd / speech-2.8-turbo 等）。"""
    k = (tts_model or "").strip().lower()
    return 2.0 if "turbo" in k else 3.5


def estimate_tts_cost_cny(*, tts_model: str, spoken_text: str) -> float:
    bc = minimax_billing_chars(spoken_text)
    if bc <= 0:
        return 0.0
    rate = tts_price_cny_per_10k_billing_chars(tts_model)
    return round((bc / 10_000.0) * rate, 6)


IMAGE_01_UNIT_CNY = 0.025


def _payload_source_char_est(payload: dict[str, Any]) -> int:
    parts: list[str] = []
    t = str(payload.get("text") or "").strip()
    if t:
        parts.append(t)
    u = str(payload.get("url") or "").strip()
    if u:
        parts.append(u)
    sn = payload.get("selected_note_ids")
    if isinstance(sn, list) and sn:
        parts.append("x" * min(8000, len(sn) * 400))
    return len("\n".join(parts))


def build_usage_event_meta(job: dict[str, Any], status: str) -> dict[str, Any]:
    """
    为 usage_events.meta 填入分项估算（CNY）。
    不含缓存命中读写（无运行时数据）；成功/失败均做展示用估算，失败任务也可能已产生调用。
    """
    payload = _parse_jsonish(job.get("payload"))
    result = _parse_jsonish(job.get("result"))
    jt = str(job.get("job_type") or "").strip()
    text_model = str(os.getenv("MINIMAX_TEXT_MODEL") or "MiniMax-M2.7").strip()
    tts_model = str(os.getenv("MINIMAX_TTS_MODEL") or "speech-2.8-hd").strip()
    image_model = str(os.getenv("MINIMAX_IMAGE_MODEL") or "image-01-live").strip()

    llm = 0.0
    tts = 0.0
    img = 0.0

    want_cover = bool(payload.get("generate_cover", True))

    if jt in ("voice_clone", "clone_voice"):
        pass
    elif jt in ("cover_image", "image_generate"):
        if status == "succeeded":
            img += IMAGE_01_UNIT_CNY
    elif jt in ("text_to_speech", "tts"):
        body = str(payload.get("text") or "")
        intro = str(payload.get("intro_text") or "")
        outro = str(payload.get("outro_text") or str(payload.get("ending_text") or ""))
        spoken = "\n".join(x for x in (intro, body, outro) if x.strip())
        if not spoken.strip():
            spoken = "你好，欢迎使用 AI Native Studio。"
        tts += estimate_tts_cost_cny(tts_model=tts_model, spoken_text=spoken)
        if want_cover and result.get("cover_image"):
            img += IMAGE_01_UNIT_CNY
    elif jt in ("podcast_generate", "podcast"):
        src_chars = _payload_source_char_est(payload)
        script = str(
            result.get("script_text") or result.get("preview") or result.get("script_preview") or ""
        )
        llm += estimate_llm_cost_cny(
            text_model=text_model, prompt_chars=src_chars, completion_chars=len(script)
        )
        intro = str(payload.get("intro_text") or "")
        outro = str(payload.get("outro_text") or str(payload.get("ending_text") or ""))
        spoken = "\n".join(x for x in (intro, script, outro) if x.strip())
        tts += estimate_tts_cost_cny(tts_model=tts_model, spoken_text=spoken)
        if want_cover and result.get("cover_image"):
            img += IMAGE_01_UNIT_CNY
    elif jt in ("script_draft", "polish_tts_text", "note_podcast_script"):
        src_chars = _payload_source_char_est(payload)
        script = str(result.get("preview") or result.get("script_preview") or "")
        if jt == "polish_tts_text":
            body = str(payload.get("text") or "")
            llm += estimate_llm_cost_cny(
                text_model=text_model, prompt_chars=len(body), completion_chars=len(script)
            )
        else:
            llm += estimate_llm_cost_cny(
                text_model=text_model, prompt_chars=src_chars, completion_chars=len(script)
            )
        if want_cover and result.get("cover_image"):
            img += IMAGE_01_UNIT_CNY
    else:
        src_chars = _payload_source_char_est(payload)
        script = str(result.get("preview") or result.get("script_preview") or "")
        if src_chars or script:
            llm += estimate_llm_cost_cny(
                text_model=text_model, prompt_chars=src_chars, completion_chars=len(script)
            )
        if want_cover and result.get("cover_image"):
            img += IMAGE_01_UNIT_CNY

    total = round(llm + tts + img, 6)
    return {
        "status": status,
        "job_type": jt,
        "llm_cost_cny": float(llm),
        "tts_cost_cny": float(tts),
        "image_cost_cny": float(img),
        "cost_total_cny": float(total),
        "text_model_pricing": text_model,
        "tts_model_pricing": tts_model,
        "image_model_hint": image_model if img > 0 else "",
        "pricing_ref": "https://platform.minimaxi.com/docs/guides/pricing-paygo",
    }

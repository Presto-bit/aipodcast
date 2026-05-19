"""
按 TEXT_PROVIDER 选用 MiniMax / DeepSeek（及 Qwen 近似）公开价估算用量看板。

定价参考（人民币，与官网/商务口径对齐；实际以各控制台账单为准）：

- **MiniMax T2A**（元/万计费字符，`minimax_billing_chars`）：turbo 档 2；HD 档 3.5。
  turbo：`speech-2.8-turbo`、`speech-2.6-turbo`、`speech-02-turbo` 等；HD：`speech-2.8-hd`、
  `speech-2.6-hd`、`speech-02-hd` 等（见 ``MINIMAX_TTS_*`` 常量）。
- **Voice Cloning / Voice Design**：各 9.9 元/次（``MINIMAX_VOICE_CLONE_REF_CNY_PER_CALL``、
  ``MINIMAX_VOICE_DESIGN_REF_CNY_PER_CALL``）。
- **image-01-live**：0.025 元/张（``MINIMAX_IMAGE_01_LIVE_REF_CNY_PER_IMAGE``）。
- **MiniMax-M2.7**（元/百万 tokens）：输入 2.1、输出 8.4、缓存读取 0.42、缓存写入 2.625。
- **DeepSeek V4**（元/百万 tokens，官网定价页）：``deepseek-v4-flash`` 未命中输入 1、输出 2；命中输入 0.2；
  ``deepseek-v4-pro`` 未命中 12、输出 24；``deepseek-chat`` / ``deepseek-reasoner`` 仍兼容且映射至 Flash 档位。
  ``estimate_llm_cost_cny`` 无缓存命中信息，输入按**未命中**计价（偏保守）。
- **豆包语音转写**：``DOUBAO_SEED_ASR_REFERENCE_CNY_PER_AUDIO_HOUR``（元/小时音频）。
- **Embedding**（如 MiniMax ``embo-01``，元/百万 tokens）：``EMBEDDING_REFERENCE_CNY_PER_MTOK``（默认 0.5）。
  仅 ``api`` 后端计费；``local`` / ``hash`` 不计入。用户钱包扣费口径不变。

链接：MiniMax https://platform.minimaxi.com/docs/guides/pricing-paygo
DeepSeek https://api-docs.deepseek.com/zh-cn/quick_start/pricing
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

ZH_RE = re.compile(r"[\u4e00-\u9fff]")

# ---------------------------------------------------------------------------
# 公开价参考（人民币；看板估算；实际以供应商控制台为准）
# ---------------------------------------------------------------------------

# MiniMax T2A：元 / 万「计费字符」（规则见 minimax_billing_chars）
MINIMAX_TTS_TURBO_CNY_PER_10K_BILLING_CHARS = 2.0
MINIMAX_TTS_HD_CNY_PER_10K_BILLING_CHARS = 3.5

MINIMAX_VOICE_CLONE_REF_CNY_PER_CALL = 9.9
MINIMAX_VOICE_DESIGN_REF_CNY_PER_CALL = 9.9

MINIMAX_IMAGE_01_LIVE_REF_CNY_PER_IMAGE = 0.025

# MiniMax-M2.7：元 / 百万 tokens
MINIMAX_M27_INPUT_CNY_PER_MTOK = 2.1
MINIMAX_M27_OUTPUT_CNY_PER_MTOK = 8.4
MINIMAX_M27_CACHE_READ_CNY_PER_MTOK = 0.42
MINIMAX_M27_CACHE_WRITE_CNY_PER_MTOK = 2.625

# DeepSeek V4 Flash（元/百万 tokens；与官网「模型 & 价格」表一致）
DEEPSEEK_V4_FLASH_INPUT_CACHE_HIT_CNY_PER_MTOK = 0.2
DEEPSEEK_V4_FLASH_INPUT_CACHE_MISS_CNY_PER_MTOK = 1.0
DEEPSEEK_V4_FLASH_OUTPUT_CNY_PER_MTOK = 2.0
# DeepSeek V4 Pro
DEEPSEEK_V4_PRO_INPUT_CACHE_MISS_CNY_PER_MTOK = 12.0
DEEPSEEK_V4_PRO_OUTPUT_CNY_PER_MTOK = 24.0
# 兼容旧名 deepseek-chat / deepseek-reasoner（官方映射至 V4-Flash，计价同 Flash）
DEEPSEEK_CHAT_INPUT_CACHE_HIT_CNY_PER_MTOK = DEEPSEEK_V4_FLASH_INPUT_CACHE_HIT_CNY_PER_MTOK
DEEPSEEK_CHAT_INPUT_CACHE_MISS_CNY_PER_MTOK = DEEPSEEK_V4_FLASH_INPUT_CACHE_MISS_CNY_PER_MTOK
DEEPSEEK_CHAT_OUTPUT_CNY_PER_MTOK = DEEPSEEK_V4_FLASH_OUTPUT_CNY_PER_MTOK

# Embedding（如 embo-01）：元 / 百万 tokens；看板参考价，实际以控制台账单为准
EMBEDDING_REFERENCE_CNY_PER_MTOK = 0.5


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


def _want_generate_cover_for_billing(payload: dict[str, Any], job_type: str) -> bool:
    """与 worker_tasks._payload_wants_generate_cover 一致（含 script_draft 与播客 article 分支）。"""
    om = str(payload.get("output_mode") or "").strip().lower()
    jt = str(job_type or "").strip()
    if om == "article" and jt == "script_draft":
        return bool(payload.get("generate_cover"))
    if om == "article" and jt in ("podcast_generate", "podcast"):
        return payload.get("generate_cover") is not False
    return bool(payload.get("generate_cover", True))


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
        return (
            MINIMAX_M27_INPUT_CNY_PER_MTOK,
            MINIMAX_M27_OUTPUT_CNY_PER_MTOK,
            MINIMAX_M27_CACHE_READ_CNY_PER_MTOK,
            MINIMAX_M27_CACHE_WRITE_CNY_PER_MTOK,
        )

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


def _billing_text_provider() -> str:
    """与 provider_router 默认一致：未设置 TEXT_PROVIDER 时 deepseek。"""
    v = (os.getenv("TEXT_PROVIDER") or "deepseek").strip().lower()
    if v in ("minimax", "deepseek", "qwen"):
        return v
    return "minimax"


def _deepseek_text_model_id() -> str:
    return str(os.getenv("DEEPSEEK_TEXT_MODEL") or "deepseek-v4-flash").strip()


def _qwen_text_model_id() -> str:
    return str(os.getenv("QWEN_TEXT_MODEL") or "qwen-plus").strip()


def deepseek_text_estimate_input_output_cny_per_mtok(model_id: str) -> tuple[float, float]:
    """
    DeepSeek 人民币（元/百万 tokens）；定价见 https://api-docs.deepseek.com/zh-cn/quick_start/pricing
    - ``deepseek-v4-pro``：未命中输入 12、输出 24（无缓存命中信息时输入按未命中）。
    - ``deepseek-v4-flash``、``deepseek-chat``、``deepseek-reasoner`` 及未识别 id：按 Flash 未命中输入 1、输出 2。
    """
    k = (model_id or "").strip().lower().replace(" ", "").replace("_", "-")
    if "v4-pro" in k or k in ("deepseek-pro",):
        return (DEEPSEEK_V4_PRO_INPUT_CACHE_MISS_CNY_PER_MTOK, DEEPSEEK_V4_PRO_OUTPUT_CNY_PER_MTOK)
    return (DEEPSEEK_V4_FLASH_INPUT_CACHE_MISS_CNY_PER_MTOK, DEEPSEEK_V4_FLASH_OUTPUT_CNY_PER_MTOK)


def qwen_text_estimate_input_output_cny_per_mtok(model_id: str) -> tuple[float, float]:
    """通义千问兼容通道：DashScope 标价多为美元，此处用与 DeepSeek-V4-Flash 未命中输入同量级的人民币近似。"""
    _ = model_id
    return (
        DEEPSEEK_CHAT_INPUT_CACHE_MISS_CNY_PER_MTOK,
        DEEPSEEK_CHAT_OUTPUT_CNY_PER_MTOK,
    )


def _llm_unit_prices_cny_per_mtok() -> tuple[str, str, float, float]:
    """(provider, model_label, input_cny_per_mtok, output_cny_per_mtok)。"""
    prov = _billing_text_provider()
    if prov == "deepseek":
        mid = _deepseek_text_model_id()
        pi, po = deepseek_text_estimate_input_output_cny_per_mtok(mid)
        return (prov, mid, pi, po)
    if prov == "qwen":
        mid = _qwen_text_model_id()
        pi, po = qwen_text_estimate_input_output_cny_per_mtok(mid)
        return (prov, mid, pi, po)
    mid = str(os.getenv("MINIMAX_TEXT_MODEL") or "MiniMax-M2.7").strip()
    pi, po, _, _ = text_model_pricing_per_million_tokens(mid)
    return (prov, mid, float(pi), float(po))


def estimate_embedding_cost_cny(*, input_chars: int, backend: str | None = None) -> float:
    """按输入字符估算 embedding 参考成本（元）；hash/local 后端为 0。"""
    bk = (backend or "api").strip().lower()
    if bk in ("hash", "local", "unknown"):
        return 0.0
    if input_chars <= 0:
        return 0.0
    tok = estimate_tokens_from_chars_zh_heuristic(int(input_chars))
    return round((tok / 1_000_000.0) * EMBEDDING_REFERENCE_CNY_PER_MTOK, 6)


def _embedding_backend_billable(backend: str | None) -> bool:
    bk = (backend or "api").strip().lower()
    return bk not in ("hash", "local", "unknown", "")


def _embedding_chars_from_reference_meta(ref_meta: dict[str, Any]) -> tuple[int, str]:
    """从 merge_reference_for_script 的 meta 汇总 embedding 输入字符（避免分层字段重复累加）。"""
    try:
        chars = max(0, int(ref_meta.get("embedding_input_chars") or 0))
    except (TypeError, ValueError):
        chars = 0
    backend = str(ref_meta.get("embedding_backend") or ref_meta.get("rag_embedding_backend") or "").strip()
    if chars > 0:
        return chars, backend
    layered = ref_meta.get("notes_layered_rag_meta")
    if isinstance(layered, dict):
        try:
            chars = max(0, int(layered.get("embedding_input_chars") or 0))
        except (TypeError, ValueError):
            chars = 0
        if not backend:
            backend = str(layered.get("embedding_backend") or "").strip()
        if chars <= 0:
            obs = layered.get("retrieve_obs")
            if isinstance(obs, dict):
                try:
                    chars = max(0, int(obs.get("embedding_input_chars") or 0))
                except (TypeError, ValueError):
                    chars = 0
                if not backend:
                    backend = str(obs.get("embedding_backend") or "").strip()
    return chars, backend


def apply_reference_billing_to_result(result: dict[str, Any], ref_meta: dict[str, Any]) -> None:
    """将参考材料阶段的 embedding 计量写入 job result，供终态 usage_events 估算。"""
    if not isinstance(result, dict) or not isinstance(ref_meta, dict):
        return
    chars, backend = _embedding_chars_from_reference_meta(ref_meta)
    if chars <= 0:
        return
    prev = 0
    try:
        prev = max(0, int(result.get("embedding_input_chars") or 0))
    except (TypeError, ValueError):
        prev = 0
    result["embedding_input_chars"] = prev + chars
    if backend and not str(result.get("embedding_backend") or "").strip():
        result["embedding_backend"] = backend


def _embedding_billing_from_job(
    payload: dict[str, Any], result: dict[str, Any], job_type: str
) -> tuple[int, str]:
    """返回 (input_chars, backend)。"""
    chars = 0
    backend = ""
    try:
        chars = max(0, int(result.get("embedding_input_chars") or 0))
    except (TypeError, ValueError):
        chars = 0
    backend = str(result.get("embedding_backend") or "").strip()

    jt = (job_type or "").strip()
    if chars > 0:
        return chars, backend or "api"

    if jt == "note_rag_index":
        try:
            n_chunks = max(0, int(result.get("chunks") or 0))
        except (TypeError, ValueError):
            n_chunks = 0
        if n_chunks > 0:
            # 无精确计量时的保守近似（单块约 1200 字，实际上限 8000）
            chars = n_chunks * 1200
            backend = str(result.get("embedding_backend") or "api").strip() or "api"
        return chars, backend

    mode = str(payload.get("reference_rag_mode") or "truncate").strip().lower()
    merged_est = _payload_source_char_est(payload)
    sn = payload.get("selected_note_ids")
    if isinstance(sn, list) and sn:
        merged_est += min(8000, len(sn) * 400)

    if mode == "hybrid" and merged_est >= 12_000:
        q_extra = min(8000, len(str(payload.get("text") or "").strip()))
        chars = int(merged_est * 1.05) + q_extra
        backend = str(payload.get("rag_embedding_backend") or "api").strip() or "api"

    return chars, backend


def estimate_llm_cost_cny(*, prompt_chars: int, completion_chars: int) -> float:
    inp_t = estimate_tokens_from_chars_zh_heuristic(prompt_chars)
    out_t = estimate_tokens_from_chars_zh_heuristic(completion_chars)
    _, _mid, pi, po = _llm_unit_prices_cny_per_mtok()
    return round((inp_t / 1_000_000.0) * pi + (out_t / 1_000_000.0) * po, 6)


def tts_price_cny_per_10k_billing_chars(tts_model: str) -> float:
    """T2A：turbo / HD 档见 ``MINIMAX_TTS_TURBO_CNY_PER_10K_BILLING_CHARS`` 等；模型名含 ``turbo`` 视为 turbo 档。"""
    k = (tts_model or "").strip().lower()
    if "turbo" in k:
        return MINIMAX_TTS_TURBO_CNY_PER_10K_BILLING_CHARS
    return MINIMAX_TTS_HD_CNY_PER_10K_BILLING_CHARS


def estimate_tts_cost_cny(*, tts_model: str, spoken_text: str) -> float:
    bc = minimax_billing_chars(spoken_text)
    if bc <= 0:
        return 0.0
    rate = tts_price_cny_per_10k_billing_chars(tts_model)
    return round((bc / 10_000.0) * rate, 6)


IMAGE_01_UNIT_CNY = MINIMAX_IMAGE_01_LIVE_REF_CNY_PER_IMAGE

# 豆包语音（火山 openspeech Seed-ASR / 大模型录音文件识别）音频转写：产品侧参考公开价，按「输入音频时长」计小时。
# 用于成本/用量看板对照；实际扣费以火山控制台账单为准。
DOUBAO_SEED_ASR_REFERENCE_CNY_PER_AUDIO_HOUR = 2.3


def estimate_doubao_seed_asr_cost_cny(*, audio_seconds: float) -> float:
    """按音频秒数估算转写成本（元），线性折算到小时单价。"""
    try:
        sec = float(audio_seconds)
    except (TypeError, ValueError):
        return 0.0
    if sec <= 0:
        return 0.0
    return round((sec / 3600.0) * DOUBAO_SEED_ASR_REFERENCE_CNY_PER_AUDIO_HOUR, 6)


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
    llm_prov, text_model, llm_pi, llm_po = _llm_unit_prices_cny_per_mtok()
    tts_model = str(os.getenv("MINIMAX_TTS_MODEL") or "speech-2.8-turbo").strip()
    image_model = str(os.getenv("MINIMAX_IMAGE_MODEL") or "image-01-live").strip()

    llm = 0.0
    tts = 0.0
    img = 0.0
    emb = 0.0

    emb_model = str(os.getenv("RAG_EMBEDDING_MODEL") or "embo-01").strip()

    want_cover = _want_generate_cover_for_billing(payload, jt)

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
        llm += estimate_llm_cost_cny(prompt_chars=src_chars, completion_chars=len(script))
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
            llm += estimate_llm_cost_cny(prompt_chars=len(body), completion_chars=len(script))
        else:
            llm += estimate_llm_cost_cny(prompt_chars=src_chars, completion_chars=len(script))
        if want_cover and result.get("cover_image"):
            img += IMAGE_01_UNIT_CNY
    else:
        src_chars = _payload_source_char_est(payload)
        script = str(result.get("preview") or result.get("script_preview") or "")
        if src_chars or script:
            llm += estimate_llm_cost_cny(prompt_chars=src_chars, completion_chars=len(script))
        if want_cover and result.get("cover_image"):
            img += IMAGE_01_UNIT_CNY

    emb_chars, emb_backend = _embedding_billing_from_job(payload, result, jt)
    if emb_chars > 0 and _embedding_backend_billable(emb_backend):
        emb = estimate_embedding_cost_cny(input_chars=emb_chars, backend=emb_backend)

    total = round(llm + tts + img + emb, 6)
    return {
        "status": status,
        "job_type": jt,
        "llm_cost_cny": float(llm),
        "tts_cost_cny": float(tts),
        "image_cost_cny": float(img),
        "embedding_cost_cny": float(emb),
        "cost_total_cny": float(total),
        "llm_billing_provider": llm_prov,
        "text_model_pricing": text_model,
        "llm_input_cny_per_mtok": float(llm_pi),
        "llm_output_cny_per_mtok": float(llm_po),
        "tts_model_pricing": tts_model,
        "image_model_hint": image_model if img > 0 else "",
        "embedding_model_pricing": emb_model if emb > 0 else "",
        "embedding_input_chars": int(emb_chars) if emb_chars > 0 else 0,
        "embedding_backend": emb_backend if emb > 0 else "",
        "embedding_cny_per_mtok": float(EMBEDDING_REFERENCE_CNY_PER_MTOK) if emb > 0 else 0.0,
        "pricing_ref": "https://platform.minimaxi.com/docs/guides/pricing-paygo",
        "pricing_ref_deepseek": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
    }

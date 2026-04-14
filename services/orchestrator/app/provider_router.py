import logging
import os
from typing import Any, Callable, Iterator
import base64

from .entitlement_matrix import apply_script_options_subscription_caps
from .legacy_bridge import (
    build_script_with_minimax,
    clone_voice_with_minimax,
    default_minimax_podcast_voice_ids,
    generate_cover_image_tts_result,
    polish_text_for_tts_article,
    synthesize_tts_with_minimax,
)
from .providers.http_provider_misc import image_via_http_json, tts_via_http_json, voice_clone_via_http_json
from .providers.openai_compat_text import (
    chat_completion_openai_compatible,
    generate_script_openai_compatible,
    iter_chat_completion_openai_compatible_stream,
)
from .fyv_shared.minimax_client import minimax_client

logger = logging.getLogger(__name__)

_TEXT_PROVIDER_ENV = "TEXT_PROVIDER"
_TTS_PROVIDER_ENV = "TTS_PROVIDER"
_IMAGE_PROVIDER_ENV = "IMAGE_PROVIDER"
_VOICE_CLONE_PROVIDER_ENV = "VOICE_CLONE_PROVIDER"
# TTS / 图像 / 克隆等未设置时的默认（文本单独见 _TEXT_DEFAULT_PROVIDER）
_DEFAULT_PROVIDER = "minimax"
# 未设置 TEXT_PROVIDER 时：先 DeepSeek（OpenAI 兼容），失败再 MiniMax（见 _safe_call_with_minimax_fallback）
_TEXT_DEFAULT_PROVIDER = "deepseek"


def _effective_provider(env_name: str, *, default_if_unset: str = _DEFAULT_PROVIDER) -> str:
    raw = str(os.getenv(env_name) or "").strip().lower()
    if not raw:
        return default_if_unset
    return raw


def _safe_call_with_minimax_fallback(
    *,
    domain: str,
    provider: str,
    run_selected: Callable[[], Any],
    run_minimax: Callable[[], Any],
) -> Any:
    if provider == "minimax":
        return run_minimax()
    try:
        return run_selected()
    except Exception as exc:
        logger.warning("%s provider=%s 调用失败，回退 minimax: %s", domain, provider, exc)
        return run_minimax()


def script_provider() -> str:
    p = _effective_provider(_TEXT_PROVIDER_ENV, default_if_unset=_TEXT_DEFAULT_PROVIDER)
    if p in ("minimax", "deepseek", "qwen"):
        return p
    logger.warning("%s=%s 未实现，静默回退 minimax", _TEXT_PROVIDER_ENV, p)
    return "minimax"


def invoke_llm_chat_messages_with_minimax_fallback(
    messages: list[dict[str, Any]],
    *,
    temperature: float = 0.45,
    api_key: str | None = None,
    timeout_sec: int = 120,
) -> tuple[str, str | None]:
    """
    中文长文 / 摘要 / 按材料问答等：TEXT_PROVIDER=deepseek|qwen 时先走 OpenAI 兼容，失败再 MiniMax。
    TEXT_PROVIDER=minimax 时仅走 MiniMax。
    """
    prov = script_provider()

    def _run_minimax() -> tuple[str, str | None]:
        key = (api_key or "").strip() or str(os.getenv("MINIMAX_API_KEY") or "").strip()
        if not key:
            raise RuntimeError("minimax_api_key_missing")
        raw, tid = minimax_client.chat_completion_messages(
            messages,
            api_key=key,
            temperature=float(temperature),
        )
        return str(raw or "").strip(), (str(tid) if tid else None)

    if prov == "minimax":
        return _run_minimax()

    def _run_openai_compat() -> tuple[str, None]:
        if prov == "deepseek":
            key = str(os.getenv("DEEPSEEK_API_KEY") or "").strip()
            base = str(os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com/v1").strip()
            model = str(os.getenv("DEEPSEEK_TEXT_MODEL") or "deepseek-chat").strip()
        else:
            key = str(os.getenv("QWEN_API_KEY") or "").strip()
            base = str(os.getenv("QWEN_BASE_URL") or "").strip()
            model = str(os.getenv("QWEN_TEXT_MODEL") or "qwen-plus").strip()
        if not key or not base:
            raise RuntimeError(f"text_provider_{prov}_config_missing")
        out = chat_completion_openai_compatible(
            messages=messages,
            api_base=base,
            api_key=key,
            model=model,
            temperature=float(temperature),
            timeout_sec=int(timeout_sec),
        )
        return str(out or "").strip(), None

    try:
        text, _tid = _run_openai_compat()
        if not text:
            raise RuntimeError("openai_compatible_empty_content")
        return text, None
    except Exception as exc:
        logger.warning("invoke_llm_chat_messages provider=%s failed, fallback minimax: %s", prov, exc)
        return _run_minimax()


def invoke_llm_chat_messages_stream_iter(
    messages: list[dict[str, Any]],
    *,
    temperature: float = 0.45,
    api_key: str | None = None,
    timeout_sec: int = 120,
) -> Iterator[str]:
    """
    与 invoke_llm_chat_messages_with_minimax_fallback 相同路由策略，但以流式逐段产出文本。
    """
    prov = script_provider()

    def _iter_minimax() -> Iterator[str]:
        key = (api_key or "").strip() or str(os.getenv("MINIMAX_API_KEY") or "").strip()
        if not key:
            raise RuntimeError("minimax_api_key_missing")
        yield from minimax_client.iter_chat_completion_messages_stream(
            messages,
            api_key=key,
            temperature=float(temperature),
        )

    if prov == "minimax":
        yield from _iter_minimax()
        return

    def _iter_openai_compat() -> Iterator[str]:
        if prov == "deepseek":
            key = str(os.getenv("DEEPSEEK_API_KEY") or "").strip()
            base = str(os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com/v1").strip()
            model = str(os.getenv("DEEPSEEK_TEXT_MODEL") or "deepseek-chat").strip()
        else:
            key = str(os.getenv("QWEN_API_KEY") or "").strip()
            base = str(os.getenv("QWEN_BASE_URL") or "").strip()
            model = str(os.getenv("QWEN_TEXT_MODEL") or "qwen-plus").strip()
        if not key or not base:
            raise RuntimeError(f"text_provider_{prov}_config_missing")
        norm: list[dict[str, str]] = []
        for m in messages:
            if not isinstance(m, dict):
                continue
            role = str(m.get("role") or "user").strip()
            content = str(m.get("content") or "")
            norm.append({"role": role, "content": content})
        yield from iter_chat_completion_openai_compatible_stream(
            messages=norm,
            api_base=base,
            api_key=key,
            model=model,
            temperature=float(temperature),
            timeout_sec=int(timeout_sec),
        )

    try:
        yield from _iter_openai_compat()
    except Exception as exc:
        logger.warning("invoke_llm_chat_messages_stream provider=%s failed, fallback minimax: %s", prov, exc)
        yield from _iter_minimax()


def tts_provider() -> str:
    p = _effective_provider(_TTS_PROVIDER_ENV)
    if p in ("minimax", "doubao"):
        return p
    logger.warning("%s=%s 未实现，静默回退 minimax", _TTS_PROVIDER_ENV, p)
    return "minimax"


def image_provider() -> str:
    p = _effective_provider(_IMAGE_PROVIDER_ENV)
    if p in ("minimax", "qwen"):
        return p
    logger.warning("%s=%s 未实现，静默回退 minimax", _IMAGE_PROVIDER_ENV, p)
    return "minimax"


def voice_clone_provider() -> str:
    p = _effective_provider(_VOICE_CLONE_PROVIDER_ENV)
    if p in ("minimax", "doubao"):
        return p
    logger.warning("%s=%s 未实现，静默回退 minimax", _VOICE_CLONE_PROVIDER_ENV, p)
    return "minimax"


def default_podcast_voice_ids() -> tuple[str, str]:
    return default_minimax_podcast_voice_ids()


def build_script(
    text: str,
    api_key: str | None = None,
    *,
    force_fallback: bool = False,
    script_options: dict[str, Any] | None = None,
    on_script_delta: Callable[[str, str], None] | None = None,
    subscription_tier: str | None = None,
) -> dict[str, Any]:
    provider = script_provider()
    tier_norm = (subscription_tier or "free").strip().lower()
    opts = apply_script_options_subscription_caps(script_options or {}, tier_norm)

    def _run_minimax() -> dict[str, Any]:
        return build_script_with_minimax(
            text,
            api_key=api_key,
            force_fallback=force_fallback,
            script_options=opts,
            on_script_delta=on_script_delta,
            subscription_tier=tier_norm,
        )

    def _run_openai_compat() -> dict[str, Any]:
        if provider == "deepseek":
            key = str(os.getenv("DEEPSEEK_API_KEY") or "").strip()
            base = str(os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com/v1").strip()
            model = str(os.getenv("DEEPSEEK_TEXT_MODEL") or "deepseek-chat").strip()
        else:
            key = str(os.getenv("QWEN_API_KEY") or "").strip()
            base = str(os.getenv("QWEN_BASE_URL") or "").strip()
            model = str(os.getenv("QWEN_TEXT_MODEL") or "qwen-plus").strip()
        if not key or not base:
            raise RuntimeError(f"{provider}_config_missing")
        return generate_script_openai_compatible(
            text=text,
            api_base=base,
            api_key=key,
            model=model,
            script_options=opts,
            on_script_delta=on_script_delta,
            subscription_tier=tier_norm,
        )

    def _build() -> dict[str, Any]:
        return _safe_call_with_minimax_fallback(
            domain="text",
            provider=provider,
            run_selected=_run_openai_compat,
            run_minimax=_run_minimax,
        )

    if on_script_delta is None:
        from .script_cache import get_or_build

        return get_or_build(
            text=text,
            opts=opts,
            tier=tier_norm,
            provider=provider,
            force_fallback=force_fallback,
            builder=_build,
        )
    return _build()


def synthesize_tts(text: str, voice_id: str, api_key: str | None = None) -> dict[str, Any]:
    provider = tts_provider()

    def _run_minimax() -> dict[str, Any]:
        return synthesize_tts_with_minimax(text=text, voice_id=voice_id, api_key=api_key)

    def _run_doubao() -> dict[str, Any]:
        key = str(os.getenv("DOUBAO_API_KEY") or "").strip()
        url = str(os.getenv("DOUBAO_TTS_URL") or "").strip()
        model = str(os.getenv("DOUBAO_TTS_MODEL") or "doubao-tts").strip()
        if not key or not url:
            raise RuntimeError("doubao_tts_config_missing")
        return tts_via_http_json(url=url, api_key=key, model=model, text=text, voice_id=voice_id)

    return _safe_call_with_minimax_fallback(
        domain="tts",
        provider=provider,
        run_selected=_run_doubao,
        run_minimax=_run_minimax,
    )


def clone_voice(
    audio_bytes: bytes,
    filename: str = "voice.wav",
    display_name: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    provider = voice_clone_provider()

    def _run_minimax() -> dict[str, Any]:
        return clone_voice_with_minimax(
            audio_bytes=audio_bytes,
            filename=filename,
            display_name=display_name,
            api_key=api_key,
        )

    def _run_doubao() -> dict[str, Any]:
        key = str(os.getenv("DOUBAO_API_KEY") or "").strip()
        url = str(os.getenv("DOUBAO_VOICE_CLONE_URL") or "").strip()
        model = str(os.getenv("DOUBAO_VOICE_CLONE_MODEL") or "doubao-voice-clone").strip()
        if not key or not url:
            raise RuntimeError("doubao_clone_config_missing")
        return voice_clone_via_http_json(
            url=url,
            api_key=key,
            model=model,
            audio_b64=base64.b64encode(audio_bytes).decode("ascii"),
            filename=filename,
            display_name=display_name,
        )

    return _safe_call_with_minimax_fallback(
        domain="voice_clone",
        provider=provider,
        run_selected=_run_doubao,
        run_minimax=_run_minimax,
    )


def polish_tts_text(
    text: str,
    api_key: str | None = None,
    *,
    tts_mode: str = "single",
) -> dict[str, Any]:
    """tts_mode: single 口述；dual 双人脚本（仅 MiniMax 路径支持分段润色与 Speaker 格式）。"""
    mode = str(tts_mode or "single").strip().lower()
    if mode not in ("single", "dual"):
        mode = "single"
    provider = script_provider()

    def _run_minimax() -> dict[str, Any]:
        from . import models as orch_models

        ov = orch_models.get_tts_polish_requirement_overrides()
        return polish_text_for_tts_article(
            text,
            api_key=api_key,
            tts_mode=mode,
            dual_requirements=ov.get("dual"),
            single_requirements=ov.get("single"),
        )

    def _run_openai_compat() -> dict[str, Any]:
        output_mode = "dialogue" if mode == "dual" else "article"
        script = build_script(
            text=text,
            api_key=api_key,
            force_fallback=False,
            script_options={
                "output_mode": output_mode,
                "script_target_chars": max(200, min(8000, len(text) + 200)),
            },
            on_script_delta=None,
        )
        polished = str(script.get("script") or "").strip()
        return {"success": bool(polished), "text": polished, "trace_id": script.get("trace_id")}

    out = _safe_call_with_minimax_fallback(
        domain="text_polish",
        provider=provider,
        run_selected=_run_openai_compat,
        run_minimax=_run_minimax,
    )
    if isinstance(out, dict) and "success" not in out:
        out["success"] = bool(str(out.get("text") or "").strip())
    return out


def generate_cover_image(summary: str, api_key: str | None) -> tuple[str | None, str | None]:
    provider = image_provider()

    def _run_minimax() -> tuple[str | None, str | None]:
        return generate_cover_image_tts_result(summary, api_key)

    def _run_qwen() -> tuple[str | None, str | None]:
        key = str(os.getenv("QWEN_API_KEY") or "").strip()
        url = str(os.getenv("QWEN_IMAGE_URL") or "").strip()
        model = str(os.getenv("QWEN_IMAGE_MODEL") or "wanx-v1").strip()
        if not key or not url:
            raise RuntimeError("qwen_image_config_missing")
        return image_via_http_json(url=url, api_key=key, model=model, prompt=summary)

    return _safe_call_with_minimax_fallback(
        domain="image",
        provider=provider,
        run_selected=_run_qwen,
        run_minimax=_run_minimax,
    )

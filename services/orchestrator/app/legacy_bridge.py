import logging
import os
import re
import tempfile
import time
from typing import Any, Callable

from app.fyv_shared.config import DEFAULT_VOICES, PODCAST_CONFIG
from app.fyv_shared.content_parser import content_parser

logger = logging.getLogger(__name__)

# 与 legacy 播客生成表单默认 script_constraints 一致（双人播客）
DEFAULT_SCRIPT_CONSTRAINTS_DIALOGUE = (
    "对话内容中不能包含（笑）（停顿）（思考）等动作、心理活动或场景描述，只生成纯对话文本。"
)


def default_minimax_podcast_voice_ids() -> tuple[str, str]:
    """(speaker1/单人默认, speaker2) — 与 app/fyv_shared/config.py DEFAULT_VOICES 的 mini / max 一致。"""
    try:
        return (
            str(DEFAULT_VOICES["mini"]["voice_id"]),
            str(DEFAULT_VOICES["max"]["voice_id"]),
        )
    except Exception:
        return (
            "moss_audio_aaa1346a-7ce7-11f0-8e61-2e6e3c7ee85d",
            "moss_audio_ce44fc67-7ce3-11f0-8de5-96e35d26fb85",
        )


def default_script_target_chars() -> int:
    """与 fyv_shared.config.PODCAST_CONFIG['script_target_chars_default'] 一致。"""
    try:
        return int(PODCAST_CONFIG.get("script_target_chars_default", 200))
    except Exception:
        return 200


def parse_url_content(url: str) -> str:
    result = content_parser.parse_url(url)
    if not result.get("success"):
        return ""
    return str(result.get("content") or "").strip()


def _extract_upstream_status_code(msg: str) -> int | None:
    if not msg:
        return None
    matched = re.search(r"status[_ ]?code\s*[:=]\s*(\d+)", msg, flags=re.IGNORECASE)
    if not matched:
        return None
    try:
        return int(matched.group(1))
    except ValueError:
        return None


def get_tts_polish_default_requirements() -> dict[str, str]:
    """内置默认润色「要求」条款，供管理台展示与恢复默认。"""
    from app.fyv_shared.minimax_client import (
        TTS_POLISH_DEFAULT_DUAL_REQUIREMENTS,
        TTS_POLISH_DEFAULT_SINGLE_REQUIREMENTS,
    )

    return {
        "dual": TTS_POLISH_DEFAULT_DUAL_REQUIREMENTS,
        "single": TTS_POLISH_DEFAULT_SINGLE_REQUIREMENTS,
    }


def polish_text_for_tts_article(
    text: str,
    api_key: str | None = None,
    *,
    tts_mode: str = "single",
    dual_requirements: str | None = None,
    single_requirements: str | None = None,
) -> dict[str, Any]:
    """调用 MiniMax 文本模型，将书面稿润色为更适合 TTS 的口语风格（单人或双人脚本）。"""
    from app.fyv_shared.minimax_client import minimax_client

    return minimax_client.polish_article_for_tts(
        text,
        api_key=api_key,
        tts_mode=tts_mode,
        dual_requirements=dual_requirements,
        single_requirements=single_requirements,
    )


def polish_intro_outro_bundle_for_tts(
    intro: str,
    outro: str,
    api_key: str | None = None,
) -> dict[str, Any]:
    """单次调用润色开场+收场；失败时由调用方回退为两次独立润色。"""
    from app.fyv_shared.minimax_client import minimax_client

    return minimax_client.polish_intro_outro_bundle(intro, outro, api_key=api_key)


def synthesize_tts_with_minimax(text: str, voice_id: str, api_key: str | None = None) -> dict[str, Any]:
    from app.fyv_shared.minimax_client import minimax_client

    trace_id: str | None = None
    last_upstream_status_code: int | None = None
    attempt_errors: list[dict[str, Any]] = []
    audio_hex = ""
    for ev in minimax_client.synthesize_speech_stream(text=text, voice_id=voice_id, api_key=api_key):
        ev_trace_id = ev.get("trace_id")
        if ev_trace_id:
            trace_id = str(ev_trace_id)
        if ev.get("type") == "audio_chunk":
            audio_hex = str(ev.get("audio") or "")
        elif ev.get("type") == "error":
            msg = str(ev.get("message") or "tts_failed")
            code = _extract_upstream_status_code(msg)
            if code is not None:
                last_upstream_status_code = code
            attempt_errors.append({"attempt": 1, "message": msg, "trace_id": trace_id, "upstream_status_code": code})
            raise RuntimeError(msg)
        elif ev.get("type") == "tts_complete":
            break
    if not audio_hex:
        msg = "语音合成失败: 未返回音频数据"
        attempt_errors.append({"attempt": 1, "message": msg, "trace_id": trace_id})
        raise RuntimeError(msg)
    return {
        "audio_hex": audio_hex,
        "trace_id": trace_id,
        "upstream_status_code": last_upstream_status_code,
        "attempt_errors": attempt_errors,
        "retries": 0,
    }


def generate_cover_image_tts_result(summary: str, api_key: str | None) -> tuple[str | None, str | None]:
    """文生图封面：成功返回 (url, None)，失败返回 (None, 简短原因)。"""
    if not api_key:
        return None, "未配置 MINIMAX_API_KEY"
    s = (summary or "").strip()
    if not s:
        return None, "摘要为空，跳过封面"
    try:
        from app.fyv_shared.minimax_client import minimax_client

        cr = minimax_client.generate_cover_image(s[:1200], api_key=api_key)
        if cr.get("success") and cr.get("image_url"):
            return str(cr["image_url"]), None
        err = str(cr.get("error") or cr.get("message") or "上游未返回 image_url")
        return None, err[:400]
    except Exception as exc:
        logger.warning("generate_cover_image_tts: %s", exc)
        return None, str(exc)[:400]


def generate_cover_image_tts(summary: str, api_key: str | None) -> str | None:
    """文生图封面（失败则返回 None）。"""
    url, _ = generate_cover_image_tts_result(summary, api_key)
    return url


def clone_voice_with_minimax(
    audio_bytes: bytes,
    filename: str = "voice.wav",
    display_name: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    from app.fyv_shared.minimax_client import minimax_client

    safe_name = re.sub(r"[^a-zA-Z0-9_]+", "_", (display_name or "").strip()).strip("_")
    voice_id = f"clone_{safe_name}" if safe_name else f"clone_{int(time.time())}"
    voice_id = voice_id[:40]

    suffix = os.path.splitext(filename or "")[1] or ".wav"
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as fp:
            fp.write(audio_bytes)
            temp_path = fp.name

        out = minimax_client.clone_voice(temp_path, voice_id=voice_id, api_key=api_key)
        if not out.get("success"):
            raise RuntimeError(str(out.get("error") or out.get("message") or "voice_clone_failed"))
        return {
            "voice_id": out.get("voice_id") or voice_id,
            "upload_trace_id": out.get("upload_trace_id"),
            "clone_trace_id": out.get("clone_trace_id"),
            "message": out.get("message") or "音色克隆成功",
        }
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                pass


def script_generation_options_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """从任务 payload 提取脚本生成可选参数（播客脚本相关字段子集）。

    未包含：script_mode / manual_script（手工整稿绕过模型）——由上游直接传 text 或另行扩展任务类型。
    """
    out: dict[str, Any] = {}
    for k in (
        "script_style",
        "script_language",
        "program_name",
        "speaker1_persona",
        "speaker2_persona",
        "script_constraints",
        "output_mode",
    ):
        v = payload.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()
    raw = payload.get("script_target_chars")
    if raw is not None:
        try:
            n = int(raw)
            if 200 <= n <= 20_000:
                out["script_target_chars"] = n
        except (TypeError, ValueError):
            pass
    if "oral_for_tts" in payload:
        out["oral_for_tts"] = bool(payload.get("oral_for_tts"))
    return out


def build_script_with_minimax(
    text: str,
    api_key: str | None = None,
    *,
    force_fallback: bool = False,
    script_options: dict[str, Any] | None = None,
    on_script_delta: Callable[[str, str], None] | None = None,
    subscription_tier: str | None = None,
) -> dict[str, Any]:
    from app.fyv_shared.minimax_client import minimax_client

    from .entitlement_matrix import long_form_script_chars_cap

    if force_fallback or os.getenv("AI_NATIVE_FORCE_FALLBACK", "0") in ("1", "true", "True"):
        seed = (text or "AI Native 架构").replace("\n", " ").strip()[:120]
        return {
            "script": (
                f"Speaker1: 今天我们用三点快速梳理这个主题：{seed}。\n"
                f"Speaker2: 第一，入口与编排解耦；第二，任务异步化与事件流；第三，数据与对象存储分层。\n"
                "Speaker1: 结论是先保证链路稳定可观测，再逐步提升模型生成质量。"
            ),
            "fallback": True,
            "retries": 0,
            "trace_id": None,
            "upstream_status_code": None,
            "attempt_errors": [{"attempt": 0, "message": "forced_fallback_for_test"}],
            "error_message": "forced_fallback_for_test",
        }

    opts = script_options or {}
    tier_cap = long_form_script_chars_cap(subscription_tier)
    oral_for_tts = bool(opts.get("oral_for_tts", True))
    _dft_chars = default_script_target_chars()
    try:
        _pref_max = int(PODCAST_CONFIG.get("script_target_chars_preferred_max", 2400))
    except Exception:
        _pref_max = 2400
    _explicit_target = "script_target_chars" in opts and opts.get("script_target_chars") is not None
    try:
        base = int(opts.get("script_target_chars") or _dft_chars)
    except (TypeError, ValueError):
        base = _dft_chars
    base = max(200, min(tier_cap, base))
    if not _explicit_target:
        base = min(base, min(_pref_max, tier_cap))

    # 与 legacy 播客生成及 minimax_client.generate_script_stream 默认一致
    script_style = str(opts.get("script_style") or "轻松幽默，自然流畅").strip()
    script_language = str(opts.get("script_language") or "中文").strip()
    program_name = str(opts.get("program_name") or "MiniMax AI 播客节目").strip()
    speaker1 = str(opts.get("speaker1_persona") or "活泼亲切，引导话题").strip()
    speaker2 = str(opts.get("speaker2_persona") or "稳重专业，深度分析").strip()
    output_mode = str(opts.get("output_mode") or "dialogue").strip().lower()
    if output_mode not in ("dialogue", "article"):
        output_mode = "dialogue"

    user_c = str(opts.get("script_constraints") or "").strip()
    # 双人：未显式传约束时使用默认双人约束；文章：空约束交给 minimax_client →「无额外约束」
    if output_mode == "article":
        first_constraints = user_c
    else:
        first_constraints = user_c if user_c else DEFAULT_SCRIPT_CONSTRAINTS_DIALOGUE
    # 双人模式重试时仍约束行格式，避免模型输出无 Speaker 行导致整段被当作单人朗读（podcast_generator 按行解析）
    retry_constraints_dialogue = (
        "必须输出双人对话；每行以 Speaker1: 或 Speaker2: 开头，一行一句。"
        "台词正文不要出现英文 Speaker、Mini、Max 等标签字样。"
    )

    if output_mode == "article":
        attempts = [
            {"target_chars": base, "script_constraints": first_constraints},
            {"target_chars": max(200, base - 200), "script_constraints": ""},
            {"target_chars": max(200, base - 400), "script_constraints": ""},
        ]
    else:
        attempts = [
            {"target_chars": base, "script_constraints": first_constraints},
            {"target_chars": max(200, base - 200), "script_constraints": retry_constraints_dialogue},
            {"target_chars": max(200, base - 400), "script_constraints": retry_constraints_dialogue},
        ]
    errors: list[str] = []
    attempt_errors: list[dict[str, Any]] = []
    trace_id: str | None = None
    last_upstream_status_code: int | None = None
    for idx, cfg in enumerate(attempts, start=1):
        chunks: list[str] = []
        try:
            for ev in minimax_client.generate_script_stream(
                text,
                target_chars=cfg["target_chars"],
                api_key=api_key,
                script_style=script_style,
                script_language=script_language,
                program_name=program_name,
                speaker1_persona=speaker1,
                speaker2_persona=speaker2,
                script_constraints=cfg["script_constraints"],
                output_mode=output_mode,
                oral_for_tts=oral_for_tts,
            ):
                ev_trace_id = ev.get("trace_id")
                if ev_trace_id:
                    trace_id = str(ev_trace_id)
                if ev.get("type") == "script_chunk":
                    chunk = str(ev.get("content") or "")
                    chunks.append(chunk)
                    if on_script_delta:
                        on_script_delta("".join(chunks), chunk)
                elif ev.get("type") == "error":
                    err_msg = str(ev.get("message") or "script_generation_failed")
                    code = _extract_upstream_status_code(err_msg)
                    if code is not None:
                        last_upstream_status_code = code
                    raise RuntimeError(err_msg)
            script = "".join(chunks).strip()
            if script:
                return {
                    "script": script,
                    "fallback": False,
                    "retries": idx - 1,
                    "trace_id": trace_id,
                    "upstream_status_code": last_upstream_status_code,
                    "attempt_errors": attempt_errors,
                    "error_message": "",
                }
            empty_msg = "上游返回空内容（0 chunk）"
            errors.append(empty_msg)
            attempt_errors.append({"attempt": idx, "message": empty_msg, "trace_id": trace_id})
        except Exception as exc:
            msg = str(exc) or "script_generation_failed"
            errors.append(msg)
            code = _extract_upstream_status_code(msg)
            if code is not None:
                last_upstream_status_code = code
            attempt_errors.append(
                {"attempt": idx, "message": msg, "trace_id": trace_id, "upstream_status_code": code}
            )
            logger.warning("minimax script attempt %s failed: %s", idx, msg)

    merged_error = " | ".join(errors)
    if any(k in merged_error.lower() for k in ("api key", "unauthorized", "auth", "鉴权", "密钥")):
        raise RuntimeError(merged_error or "script_generation_failed")
    # Non-auth upstream instability fallback: still return a usable draft.
    seed = (text or "AI Native 架构").replace("\n", " ").strip()[:120]
    fallback_script = (
        f"Speaker1: 今天我们用三点快速梳理这个主题：{seed}。\n"
        f"Speaker2: 第一，入口与编排解耦；第二，任务异步化与事件流；第三，数据与对象存储分层。\n"
        "Speaker1: 结论是先保证链路稳定可观测，再逐步提升模型生成质量。"
    )
    return {
        "script": fallback_script,
        "fallback": True,
        "retries": len(attempts),
        "trace_id": trace_id,
        "upstream_status_code": last_upstream_status_code,
        "attempt_errors": attempt_errors,
        "error_message": merged_error,
    }

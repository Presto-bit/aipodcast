import logging
import os
import time
import base64
import binascii
from typing import Any
from urllib.parse import urlparse

import requests

from .config import settings  # noqa: F401
from .pydub_setup import ensure_pydub_binaries

ensure_pydub_binaries()

from .legacy_bridge import script_generation_options_from_payload
from .provider_router import (
    build_script,
    clone_voice,
    default_podcast_voice_ids,
    generate_cover_image,
    synthesize_tts,
)
from .audio_mix import maybe_mix_podcast_bgm
from .auth_bridge import user_info_for_phone
from .reference_material import merge_reference_for_script
from .subscription_limits import max_note_refs_for_plan, tier_allows_ai_polish
from .tts_pipeline import (
    dialogue_speaker_format_issues,
    normalize_dialogue_speaker_lines,
    run_extended_tts,
)
from .models import (
    add_artifact,
    append_cloned_voice_for_user_uuid,
    append_job_event,
    finalize_job_terminal_unless_cancelled,
    get_job,
    try_mark_job_running,
    update_job_status,
)
from .object_store import upload_bytes, upload_text
from .storage_paths import job_artifact_base, job_cover_object_key

logger = logging.getLogger(__name__)

VOICE_CLONE_MAX_BYTES = 20 * 1024 * 1024
_COVER_MAX_BYTES = 8 * 1024 * 1024


def _cover_ext_and_type_from_content_type(content_type: str | None) -> tuple[str, str]:
    ct = str(content_type or "").strip().lower()
    if "png" in ct:
        return "png", "image/png"
    if "webp" in ct:
        return "webp", "image/webp"
    if "gif" in ct:
        return "gif", "image/gif"
    if "bmp" in ct:
        return "bmp", "image/bmp"
    if "jpeg" in ct or "jpg" in ct:
        return "jpg", "image/jpeg"
    return "jpg", "image/jpeg"


def _download_cover_bytes(cover_url: str) -> tuple[bytes | None, str | None, str | None]:
    u = str(cover_url or "").strip()
    if not u:
        return None, None, "cover_url_empty"
    if u.startswith("data:image/"):
        head, sep, data = u.partition(",")
        if not sep:
            return None, None, "cover_data_url_invalid"
        header = head.lower()
        subtype = "jpeg"
        if ";base64" in header:
            try:
                raw = base64.b64decode(data, validate=True)
            except (ValueError, binascii.Error):
                return None, None, "cover_data_url_base64_invalid"
        else:
            try:
                raw = data.encode("utf-8")
            except Exception:
                return None, None, "cover_data_url_decode_failed"
        if len(raw) <= 0:
            return None, None, "cover_data_url_empty"
        if len(raw) > _COVER_MAX_BYTES:
            return None, None, "cover_too_large"
        if "png" in header:
            subtype = "png"
        elif "webp" in header:
            subtype = "webp"
        elif "gif" in header:
            subtype = "gif"
        elif "bmp" in header:
            subtype = "bmp"
        return raw, f"image/{subtype}", None
    try:
        parsed = urlparse(u)
    except Exception:
        return None, None, "cover_url_invalid"
    if parsed.scheme not in ("http", "https"):
        return None, None, "cover_url_protocol_unsupported"
    try:
        resp = requests.get(u, timeout=25, stream=True)
        resp.raise_for_status()
        chunks: list[bytes] = []
        total = 0
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > _COVER_MAX_BYTES:
                return None, None, "cover_too_large"
            chunks.append(chunk)
        raw = b"".join(chunks)
        if not raw:
            return None, None, "cover_download_empty"
        ct = resp.headers.get("content-type") or ""
        return raw, ct, None
    except Exception as exc:
        return None, None, f"cover_download_failed:{str(exc)[:180]}"


def _persist_cover_for_job(job_id: str, created_by: Any, cover_url: str) -> tuple[str | None, str | None, str | None]:
    raw, content_type, err = _download_cover_bytes(cover_url)
    if err or not raw:
        return None, None, err or "cover_download_failed"
    ext, safe_ct = _cover_ext_and_type_from_content_type(content_type)
    object_key = job_cover_object_key(job_id, _storage_owner_uuid(created_by), ext=ext)
    try:
        upload_bytes(object_key, raw, content_type=safe_ct)
        return object_key, safe_ct, None
    except Exception as exc:
        return None, None, f"cover_upload_failed:{str(exc)[:180]}"


def _max_note_refs_for_job(created_by: str | None) -> int:
    phone = (created_by or "").strip()
    if not phone:
        return 1
    try:
        tier = str(user_info_for_phone(phone).get("plan") or "free")
    except Exception:
        tier = "free"
    return max_note_refs_for_plan(tier)


def _subscription_tier_for_job(created_by: str | None) -> str:
    phone = (created_by or "").strip()
    if not phone:
        return "free"
    try:
        return str(user_info_for_phone(phone).get("plan") or "free").strip().lower() or "free"
    except Exception:
        return "free"


def _effective_ai_polish(payload: dict[str, Any], created_by: str | None, job_id: str) -> bool:
    """客户端可传 ai_polish，仅 Max 且功能未关闭时生效。"""
    if not bool(payload.get("ai_polish")):
        return False
    tier = _subscription_tier_for_job(created_by)
    if tier_allows_ai_polish(tier):
        return True
    append_job_event(
        job_id,
        "log",
        "AI润色需要 Max 套餐（或管理员已关闭 AI_POLISH_FEATURE_ENABLED），已跳过",
        {"plan": tier},
    )
    return False


def _guard_cancelled(job_id: str) -> bool:
    row = get_job(job_id)
    return bool(row and row.get("status") == "cancelled")


def _storage_owner_uuid(created_by: Any) -> str | None:
    if created_by is None:
        return None
    s = str(created_by).strip()
    return s or None


def _make_script_delta_handler(job_id: str):
    """约每累积 480 字符写入 script_chunk 事件，供前端伪流式展示。"""

    pending = [0]

    def _on_delta(acc: str, delta: str) -> None:
        pending[0] += len(delta)
        if pending[0] < 480:
            return
        pending[0] = 0
        if _guard_cancelled(job_id):
            return
        tail = acc[-4000:] if len(acc) > 4000 else acc
        append_job_event(
            job_id,
            "script_chunk",
            "脚本生成中…",
            {"text_tail": tail, "total_chars": len(acc)},
        )

    return _on_delta


def run_ai_job(job_id: str) -> dict[str, Any]:
    if _guard_cancelled(job_id):
        return {"status": "cancelled"}

    if not try_mark_job_running(job_id, 5.0):
        if _guard_cancelled(job_id):
            return {"status": "cancelled"}
        append_job_event(job_id, "log", "任务已非 queued，跳过执行", {})
        return {"status": "skipped"}

    append_job_event(job_id, "progress", "任务开始执行", {"progress": 5})
    time.sleep(0.5)

    job = get_job(job_id) or {}
    payload = job.get("payload") or {}
    created_by = job.get("created_by")
    if created_by is not None:
        created_by = str(created_by)
    note_ref_cap = _max_note_refs_for_job(created_by)
    job_type = str(job.get("job_type") or "").strip()
    source_text = str(payload.get("text") or "").strip()
    source_url = str(payload.get("url") or "").strip()
    api_key = str(os.getenv("MINIMAX_API_KEY") or "").strip() or None

    try:
        if job_type in ("voice_clone", "clone_voice"):
            audio_b64 = str(payload.get("audio_b64") or "").strip()
            filename = str(payload.get("filename") or "voice.wav").strip() or "voice.wav"
            display_name = str(payload.get("display_name") or "").strip() or None
            if not audio_b64:
                raise RuntimeError("缺少音频数据")
            append_job_event(job_id, "progress", "正在上传音频并克隆音色", {"progress": 60})
            audio_bytes = base64.b64decode(audio_b64)
            if len(audio_bytes) > VOICE_CLONE_MAX_BYTES:
                raise RuntimeError("音频文件过大，最大支持 20MB")
            out = clone_voice(audio_bytes=audio_bytes, filename=filename, display_name=display_name, api_key=api_key)
            result = {
                "voice_id": out.get("voice_id"),
                "display_name": display_name,
                "upload_trace_id": out.get("upload_trace_id"),
                "clone_trace_id": out.get("clone_trace_id"),
                "message": out.get("message"),
            }
            if not finalize_job_terminal_unless_cancelled(job_id, "succeeded", progress=100, result=result):
                append_job_event(job_id, "log", "未写入成功终态（任务已取消）", {})
                return {"status": "cancelled"}
            v_id = str(out.get("voice_id") or "").strip()
            if v_id:
                append_cloned_voice_for_user_uuid(
                    str(created_by) if created_by is not None else None,
                    v_id,
                    display_name,
                )
            append_job_event(
                job_id,
                "complete",
                "音色克隆完成",
                {
                    "progress": 100,
                    "voice_id": out.get("voice_id"),
                    "upload_trace_id": out.get("upload_trace_id"),
                    "clone_trace_id": out.get("clone_trace_id"),
                },
            )
            return result

        if job_type in ("text_to_speech", "tts"):
            _mini, _ = default_podcast_voice_ids()
            voice_id = str(payload.get("voice_id") or "").strip() or _mini
            if not source_text:
                source_text = "你好，欢迎使用 AI Native Studio。"
            tts_mode = str(payload.get("tts_mode") or "single").strip().lower()
            want_polish = _effective_ai_polish(payload, created_by, job_id)
            use_extended = (
                tts_mode == "dual"
                or bool(str(payload.get("intro_text") or "").strip())
                or bool(str(payload.get("outro_text") or "").strip())
                or want_polish
            )
            append_job_event(job_id, "progress", "正在调用模型进行语音合成", {"progress": 60})
            if use_extended:
                pl = dict(payload)
                pl["text"] = source_text
                pl["ai_polish"] = want_polish

                def _tts_prog(pct: int, msg: str) -> None:
                    if _guard_cancelled(job_id):
                        return
                    append_job_event(job_id, "progress", msg, {"progress": pct})

                tts = run_extended_tts(pl, api_key=api_key, progress_hook=_tts_prog)
                _fm = str(tts.get("tts_main_body") or source_text or "").strip()
                result = {
                    "audio_hex": tts.get("audio_hex"),
                    "voice_id": voice_id,
                    "trace_id": tts.get("trace_id"),
                    "upstream_status_code": tts.get("upstream_status_code"),
                    "retries": int(tts.get("retries") or 0),
                    "nonfatal_errors": tts.get("nonfatal_errors") or [],
                    "polished": bool(tts.get("polished")),
                    "tts_mode": tts.get("tts_mode") or tts_mode,
                    "script_text": _fm,
                    "script_preview": _fm[:240],
                    "preview": _fm[:240],
                }
                _it = str(tts.get("tts_intro_text") or "").strip()
                _ot = str(tts.get("tts_outro_text") or "").strip()
                if _it:
                    result["tts_intro_text"] = _it
                if _ot:
                    result["tts_outro_text"] = _ot
                if tts.get("cover_image"):
                    result["cover_image"] = tts.get("cover_image")
                    cov_key, cov_ct, cov_err = _persist_cover_for_job(job_id, created_by, str(tts.get("cover_image") or ""))
                    if cov_key:
                        result["cover_object_key"] = cov_key
                        result["cover_content_type"] = cov_ct or "image/jpeg"
                        result["cover_image"] = f"/api/jobs/{job_id}/cover"
                    elif cov_err:
                        append_job_event(job_id, "log", "封面持久化失败，继续使用外链", {"detail": cov_err[:500]})
                elif bool(payload.get("generate_cover", True)) and tts.get("cover_error"):
                    append_job_event(
                        job_id,
                        "log",
                        "封面生成未成功",
                        {"detail": str(tts.get("cover_error") or "")[:500]},
                    )
            else:
                tts = synthesize_tts(source_text, voice_id=voice_id, api_key=api_key)
                result = {
                    "audio_hex": tts.get("audio_hex"),
                    "voice_id": voice_id,
                    "trace_id": tts.get("trace_id"),
                    "upstream_status_code": tts.get("upstream_status_code"),
                    "retries": int(tts.get("retries") or 0),
                    "nonfatal_errors": tts.get("attempt_errors") or [],
                }
                if bool(payload.get("generate_cover", True)):
                    if not api_key:
                        append_job_event(job_id, "log", "跳过封面（未配置 MINIMAX_API_KEY）", {})
                    else:
                        s = (source_text or "").strip()[:1200]
                        if s:
                            ci, cerr = generate_cover_image(s, api_key)
                            if ci:
                                result["cover_image"] = ci
                            elif cerr:
                                append_job_event(
                                    job_id,
                                    "log",
                                    "封面生成未成功",
                                    {"detail": cerr[:500]},
                                )
            if not finalize_job_terminal_unless_cancelled(job_id, "succeeded", progress=100, result=result):
                append_job_event(job_id, "log", "未写入成功终态（任务已取消）", {})
                return {"status": "cancelled"}
            append_job_event(
                job_id,
                "complete",
                "语音合成完成",
                {
                    "progress": 100,
                    "trace_id": result.get("trace_id"),
                    "retries": int(result.get("retries") or 0),
                    "upstream_status_code": result.get("upstream_status_code"),
                },
            )
            return result

        append_job_event(job_id, "progress", "正在汇总参考材料（多 URL / 笔记 / 附加文本）", {"progress": 18})
        source_text, ref_meta = merge_reference_for_script(
            payload, source_text, source_url, api_key, max_note_refs=note_ref_cap, user_ref=created_by
        )
        append_job_event(job_id, "log", "参考材料汇总", ref_meta)

        if not source_text.strip():
            source_text = "请介绍 AI Native 应用架构"

        if _guard_cancelled(job_id):
            return {"status": "cancelled"}

        append_job_event(job_id, "progress", "正在调用模型生成脚本", {"progress": 60})
        force_fb = bool(payload.get("integration_force_fallback"))
        gen = build_script(
            source_text,
            api_key=api_key,
            force_fallback=force_fb,
            script_options=script_generation_options_from_payload(payload),
            on_script_delta=_make_script_delta_handler(job_id),
            subscription_tier=_subscription_tier_for_job(created_by),
        )
        script = str(gen.get("script") or "")
        fallback = bool(gen.get("fallback"))
        retries = int(gen.get("retries") or 0)
        trace_id = gen.get("trace_id")
        upstream_status_code = gen.get("upstream_status_code")
        nonfatal_error = str(gen.get("error_message") or "")
        attempt_errors = gen.get("attempt_errors") or []

        append_job_event(
            job_id,
            "log",
            "脚本生成执行信息",
            {
                "trace_id": trace_id,
                "upstream_status_code": upstream_status_code,
                "retries": retries,
                "fallback": fallback,
                "nonfatal_error": nonfatal_error,
                "nonfatal_errors": attempt_errors,
            },
        )

        if _guard_cancelled(job_id):
            return {"status": "cancelled"}

        _base = job_artifact_base(job_id, _storage_owner_uuid(job.get("created_by")))
        object_key = f"{_base}/script.txt"
        upload_text(object_key, script)
        add_artifact(job_id, "script", object_key)
        append_job_event(job_id, "progress", "脚本已生成并上传对象存储", {"progress": 90, "object_key": object_key})

        result = {
            "artifact": {"type": "script", "object_key": object_key},
            "preview": script[:240],
            "fallback": fallback,
            "trace_id": trace_id,
            "upstream_status_code": upstream_status_code,
            "retries": retries,
            "nonfatal_errors": attempt_errors,
        }
        if bool(payload.get("generate_cover", True)) and api_key:
            ci, cerr = generate_cover_image(script[:1200], api_key)
            if ci:
                result["cover_image"] = ci
                cov_key, cov_ct, cov_err = _persist_cover_for_job(job_id, created_by, str(ci))
                if cov_key:
                    result["cover_object_key"] = cov_key
                    result["cover_content_type"] = cov_ct or "image/jpeg"
                    result["cover_image"] = f"/api/jobs/{job_id}/cover"
                elif cov_err:
                    append_job_event(job_id, "log", "封面持久化失败，继续使用外链", {"detail": cov_err[:500]})
            elif cerr:
                append_job_event(job_id, "log", "封面生成未完全成功", {"detail": cerr[:500]})
        elif bool(payload.get("generate_cover", True)) and not api_key:
            append_job_event(job_id, "log", "跳过封面（未配置 MINIMAX_API_KEY）", {})
        if not finalize_job_terminal_unless_cancelled(job_id, "succeeded", progress=100, result=result):
            append_job_event(job_id, "log", "未写入成功终态（任务已取消）", {})
            return {"status": "cancelled"}
        append_job_event(job_id, "complete", "任务完成", {"progress": 100})
        return result
    except Exception as exc:
        # Ensure job reaches a terminal state even when legacy bridge/model calls fail.
        msg = str(exc) or "ai_job_failed"
        if finalize_job_terminal_unless_cancelled(job_id, "failed", progress=100, error_message=msg[:500]):
            append_job_event(job_id, "error", "任务失败", {"progress": 100, "error": msg[:500]})
        else:
            append_job_event(job_id, "log", "任务失败但终态未写入（任务已取消）", {"error": msg[:500]})
        return {"status": "failed", "error": msg}


def run_media_job(job_id: str) -> dict[str, Any]:
    """异步媒体队列：播客成片等。

    行为要点：

    - 脚本：merge_reference_for_script → build_script_with_minimax（generate_script_stream），
      默认 script_target_chars / script_constraints / output_mode 与 fyv_shared.config 一致；
      双人重试约束与「无 Speaker 行」防护同 legacy_bridge。
    - 双人 TTS：parse_tts_dialogue_lines（宽松行解析、去标签、按 Speaker 路由）；
      按 Speaker 段合成（流式场景下可按行/句更细粒度入队；此处为任务制管线，音色路由一致）。
    - 单人/文章：run_extended_tts + tts_sentence_chunks=True 时，tts_pipeline 按空行→行→句末标点切，
      再按超长软标点切，与 podcast_generator「换行/句末即一句」同一设计目标。
    - 其它：开场/结尾、intro_bgm / outro_bgm3、generate_cover、voice_id 与 voice_id_1/2、
      ending_text 与 outro_text 别名。

    本实现为任务制、先全文再合成（非交错 SSE）；manual_script 跳过模型写稿未实现。

    可选：mix_bgm 成片后叠 BGM（maybe_mix_podcast_bgm），与分段 BGM 编排不同，默认关。
    """
    if _guard_cancelled(job_id):
        return {"status": "cancelled"}
    if not try_mark_job_running(job_id, 5.0):
        if _guard_cancelled(job_id):
            return {"status": "cancelled"}
        append_job_event(job_id, "log", "任务已非 queued，跳过执行", {})
        return {"status": "skipped"}
    append_job_event(job_id, "progress", "媒体任务启动", {"progress": 5})
    job = get_job(job_id) or {}
    payload = job.get("payload") or {}
    created_by = job.get("created_by")
    if created_by is not None:
        created_by = str(created_by)
    note_ref_cap = _max_note_refs_for_job(created_by)
    job_type = str(job.get("job_type") or "").strip()
    source_text = str(payload.get("text") or "").strip()
    source_url = str(payload.get("url") or "").strip()
    api_key = str(os.getenv("MINIMAX_API_KEY") or "").strip() or None

    try:
        if job_type in ("podcast_generate", "podcast"):
            append_job_event(job_id, "progress", "正在汇总参考材料（多 URL / 笔记 / 附加文本）", {"progress": 18})
            source_text, ref_meta = merge_reference_for_script(
                payload, source_text, source_url, api_key, max_note_refs=note_ref_cap, user_ref=created_by
            )
            append_job_event(job_id, "log", "参考材料汇总", ref_meta)
            if not source_text.strip():
                source_text = "请生成一段 AI Native 播客稿件。"

            append_job_event(job_id, "progress", "正在生成播客脚本", {"progress": 45})
            force_fb = bool(payload.get("integration_force_fallback"))
            gen = build_script(
                source_text,
                api_key=api_key,
                force_fallback=force_fb,
                script_options=script_generation_options_from_payload(payload),
                on_script_delta=_make_script_delta_handler(job_id),
                subscription_tier=_subscription_tier_for_job(created_by),
            )
            script = str(gen.get("script") or "").strip() or "播客脚本生成失败"
            output_mode = str(payload.get("output_mode") or "dialogue").strip().lower()
            if output_mode not in ("dialogue", "article"):
                output_mode = "dialogue"
            if output_mode == "dialogue":
                script = normalize_dialogue_speaker_lines(script)
                _sp_issues = dialogue_speaker_format_issues(script)
                if _sp_issues:
                    append_job_event(
                        job_id,
                        "log",
                        "文稿 Speaker 行格式仍异常（请人工检查）",
                        {"issues": _sp_issues[:25]},
                    )
            append_job_event(job_id, "progress", "脚本已生成，正在上传并准备语音合成…", {"progress": 55})
            _mbase = job_artifact_base(job_id, _storage_owner_uuid(job.get("created_by")))
            script_key = f"{_mbase}/podcast_script.txt"
            upload_text(script_key, script)
            add_artifact(job_id, "script", script_key)

            append_job_event(job_id, "progress", "正在调用语音合成（开场 / 对白 / 结尾）…", {"progress": 68})
            append_job_event(job_id, "progress", "正在合成播客音频", {"progress": 75})
            _def_mini, _def_max = default_podcast_voice_ids()
            voice_id = str(payload.get("voice_id") or "").strip() or _def_mini
            voice_id_1 = str(payload.get("voice_id_1") or "").strip() or voice_id
            voice_id_2 = str(payload.get("voice_id_2") or "").strip() or _def_max
            intro_text = str(payload.get("intro_text") or "").strip()
            outro_text = str(payload.get("outro_text") or str(payload.get("ending_text") or "")).strip()
            gen_cover = bool(payload.get("generate_cover", True))

            if output_mode == "article":
                tts_pl: dict[str, Any] = {
                    "text": script,
                    "tts_mode": "single",
                    "voice_id": voice_id,
                    "intro_text": intro_text,
                    "outro_text": outro_text,
                    "generate_cover": gen_cover,
                    # 与 podcast_generator 一致：正文按句切块多次 TTS 再拼接，听感更自然
                    "tts_sentence_chunks": bool(payload.get("tts_sentence_chunks", True)),
                    # 默认 2000：减少 TTS 往返；可通过 payload 覆盖
                    "tts_max_chunk_chars": 2000,
                }
                _mc = payload.get("tts_max_chunk_chars")
                if _mc is not None and str(_mc).strip() != "":
                    tts_pl["tts_max_chunk_chars"] = _mc
            else:
                tts_pl = {
                    "text": script,
                    "tts_mode": "dual",
                    "voice_id_1": voice_id_1,
                    "voice_id_2": voice_id_2,
                    "intro_text": intro_text,
                    "outro_text": outro_text,
                    "generate_cover": gen_cover,
                }
            _tts_extra = (
                "intro_voice_id",
                "outro_voice_id",
                "intro_bgm1_slot",
                "intro_bgm1_mp3_hex",
                "intro_bgm2_slot",
                "intro_bgm2_mp3_hex",
                "outro_bgm3_slot",
                "outro_bgm3_mp3_hex",
            )
            for _k in _tts_extra:
                _v = payload.get(_k)
                if _v is not None and str(_v).strip() != "":
                    tts_pl[_k] = _v
            _want_polish = _effective_ai_polish(payload, created_by, job_id)
            tts_pl["ai_polish"] = _want_polish
            # 脚本已在生成阶段注入 TTS 口语约束；开启 AI 润色时默认跳过正文二次文本润色（force_tts_text_polish_main 可强制再润色）
            tts_pl["skip_model_polish_main"] = bool(_want_polish) and not bool(
                payload.get("force_tts_text_polish_main", False)
            )

            def _media_tts_prog(pct: int, msg: str) -> None:
                if _guard_cancelled(job_id):
                    return
                append_job_event(job_id, "progress", msg, {"progress": pct})

            tts = run_extended_tts(tts_pl, api_key=api_key, progress_hook=_media_tts_prog)
            raw_hex = str(tts.get("audio_hex") or "")
            audio_hex = maybe_mix_podcast_bgm(raw_hex, payload)
            if bool(payload.get("mix_bgm")) and audio_hex != raw_hex:
                append_job_event(job_id, "log", "已尝试 BGM 混音", {"bgm_slot": str(payload.get("bgm_slot") or "bgm01")})

            script_after_tts = str(tts.get("tts_main_body") or "").strip() or script
            upload_text(script_key, script_after_tts)

            primary_voice = voice_id if output_mode == "article" else voice_id_1
            result = {
                "preview": script_after_tts[:240],
                "script_preview": script_after_tts[:240],
                "script_text": script_after_tts,
                "script_url": "",
                "script_object_key": script_key,
                "audio_hex": audio_hex,
                "voice_id": primary_voice,
                "trace_id": tts.get("trace_id") or gen.get("trace_id"),
                "fallback": bool(gen.get("fallback")),
                "retries": int(gen.get("retries") or 0) + int(tts.get("retries") or 0),
                "upstream_status_code": tts.get("upstream_status_code"),
                "nonfatal_errors": (gen.get("attempt_errors") or []) + (tts.get("nonfatal_errors") or []),
                "polished": bool(tts.get("polished")),
            }
            _it = str(tts.get("tts_intro_text") or "").strip()
            _ot = str(tts.get("tts_outro_text") or "").strip()
            if _it:
                result["tts_intro_text"] = _it
            if _ot:
                result["tts_outro_text"] = _ot
            if tts.get("tts_sentence_chunk_count") is not None:
                result["tts_sentence_chunk_count"] = tts.get("tts_sentence_chunk_count")
            if tts.get("cover_image"):
                result["cover_image"] = tts.get("cover_image")
                cov_key, cov_ct, cov_err = _persist_cover_for_job(job_id, created_by, str(tts.get("cover_image") or ""))
                if cov_key:
                    result["cover_object_key"] = cov_key
                    result["cover_content_type"] = cov_ct or "image/jpeg"
                    result["cover_image"] = f"/api/jobs/{job_id}/cover"
                elif cov_err:
                    append_job_event(job_id, "log", "封面持久化失败，继续使用外链", {"detail": cov_err[:500]})
            elif tts.get("cover_error"):
                append_job_event(job_id, "log", "封面生成未完全成功", {"detail": str(tts.get("cover_error") or "")[:500]})
            elif gen_cover and not api_key:
                append_job_event(job_id, "log", "跳过封面（未配置 MINIMAX_API_KEY）", {})
            try:
                from .audio_mix import mp3_hex_duration_sec

                _dur = mp3_hex_duration_sec(str(result.get("audio_hex") or ""))
                if _dur is not None:
                    result["audio_duration_sec"] = round(_dur, 2)
            except Exception:
                pass
            if not finalize_job_terminal_unless_cancelled(job_id, "succeeded", progress=100, result=result):
                append_job_event(job_id, "log", "未写入成功终态（任务已取消）", {})
                return {"status": "cancelled"}
            append_job_event(job_id, "complete", "播客生成完成", {"progress": 100, "trace_id": result.get("trace_id")})
            return result

        fail_non_podcast = os.getenv("MEDIA_WORKER_FAIL_ON_NON_PODCAST", "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        if fail_non_podcast:
            err = (
                f"媒体任务类型 {job_type!r} 尚无成片流水线；"
                "已实现类型：podcast_generate / podcast。Staging 可关闭 MEDIA_WORKER_FAIL_ON_NON_PODCAST。"
            )
            logger.warning(
                "media job rejected (MEDIA_WORKER_FAIL_ON_NON_PODCAST): job_id=%s job_type=%s",
                job_id,
                job_type,
            )
            append_job_event(job_id, "log", err, {"job_type": job_type})
            if finalize_job_terminal_unless_cancelled(job_id, "failed", progress=100, error_message=err[:500]):
                append_job_event(
                    job_id,
                    "error",
                    "媒体任务类型未支持",
                    {"progress": 100, "job_type": job_type},
                )
            return {"status": "failed", "error": err}

        logger.warning(
            "media_worker_placeholder: job_id=%s job_type=%s (no real pipeline; marking succeeded)",
            job_id,
            job_type,
        )
        append_job_event(
            job_id,
            "log",
            "非播客类媒体任务当前为占位：无实际成片，仅标记成功。生产环境可设 MEDIA_WORKER_FAIL_ON_NON_PODCAST=1 拒绝此类任务。",
            {"job_type": job_type, "placeholder": True},
        )
        time.sleep(1)
        append_job_event(job_id, "progress", "媒体占位任务执行完成", {"progress": 100})
        result = {
            "message": "media_worker_placeholder_completed",
            "job_type": job_type,
            "placeholder": True,
        }
        if not finalize_job_terminal_unless_cancelled(job_id, "succeeded", progress=100, result=result):
            append_job_event(job_id, "log", "未写入成功终态（任务已取消）", {})
            return {"status": "cancelled"}
        append_job_event(job_id, "complete", "媒体占位任务完成（无成片）", {"progress": 100})
        return result
    except Exception as exc:
        msg = str(exc) or "media_job_failed"
        if finalize_job_terminal_unless_cancelled(job_id, "failed", progress=100, error_message=msg[:500]):
            append_job_event(job_id, "error", "媒体任务失败", {"progress": 100, "error": msg[:500]})
        else:
            append_job_event(job_id, "log", "媒体任务失败但终态未写入（任务已取消）", {"error": msg[:500]})
        return {"status": "failed", "error": msg}

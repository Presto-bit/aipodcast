import json
import logging
import os
import threading
import time
import base64
import binascii
from typing import Any
from urllib.parse import urlparse

import requests

from .config import settings  # noqa: F401
from .pydub_setup import ensure_pydub_binaries

ensure_pydub_binaries()

from .entitlement_matrix import (
    normalize_script_target_input,
    voice_clone_payg_cents,
)
from .subscription_limits import tier_allows_ai_polish
from .subscription_manifest import (
    BILLING_LONG_FORM_SCRIPT_CHARS_CAP,
    BILLING_MAX_NOTE_REFS,
    PRODUCT_ENTITLEMENTS_TIER,
)
from .models import (
    add_artifact,
    append_cloned_voice_for_user_uuid,
    append_job_event,
    experience_restore_voice_minutes,
    finalize_job_terminal_unless_cancelled,
    get_job,
    media_billing_try_assert_cover_estimated_minutes,
    media_billing_try_debit_actual_minutes,
    payg_restore_minutes_from_log,
    phone_for_job_created_by,
    script_text_billing_refund,
    script_text_billing_try_debit,
    try_mark_job_running,
    update_job_status,
    wallet_credit_cents,
    wallet_try_debit_cents,
)
from .object_store import upload_bytes, upload_text
from .storage_paths import job_artifact_base, job_cover_object_key
from .note_work_meta import snapshot_notes_source_titles

logger = logging.getLogger(__name__)

VOICE_CLONE_MAX_BYTES = 20 * 1024 * 1024


def _wallet_ledger_tts_model_for_voice_billing(payload: dict[str, Any] | None) -> str:
    """与用量参考价一致：优先任务 payload.tts_model，否则 MINIMAX_TTS_MODEL 环境默认。"""
    pl = payload if isinstance(payload, dict) else {}
    m = str(pl.get("tts_model") or "").strip()
    if m:
        return m
    return str(os.getenv("MINIMAX_TTS_MODEL") or "speech-2.8-turbo").strip()


def _refund_media_wallet_job(phone: str, meta: dict[str, Any]) -> None:
    """语音任务失败或取消后退回本次从钱包扣的分、按次分钟包（若有）及体验包语音分钟。"""
    p = (phone or "").strip()
    if not p or not isinstance(meta, dict):
        return
    wc = int(meta.get("wallet_cents") or 0)
    pr = meta.get("payg_restores")
    ev = float(meta.get("experience_voice_minutes_consumed") or 0)
    if wc <= 0 and not (isinstance(pr, list) and pr) and ev <= 1e-12:
        return
    if wc > 0:
        wallet_credit_cents(p, wc)
    if isinstance(pr, list) and pr:
        payg_restore_minutes_from_log(p, pr)
    if ev > 1e-12:
        experience_restore_voice_minutes(p, ev)


def _debit_script_text_billing_or_raise(job_id: str, created_by: str | None, script_body: str) -> dict[str, Any]:
    """
    模型成稿落库后：体验包字数 + 钱包结算文本费。
    返回 billing meta（供取消时 script_text_billing_refund）；未开媒体钱包时返回空 dict。
    """
    from .media_wallet import media_wallet_billing_enabled

    if not media_wallet_billing_enabled():
        return {}
    phone = (phone_for_job_created_by(created_by) or "").strip()
    if not phone:
        return {}
    chars = len((script_body or "").strip())
    ok, meta = script_text_billing_try_debit(phone, chars)
    if not ok:
        raise RuntimeError(str((meta or {}).get("message") or "script text billing failed"))
    wc = int((meta or {}).get("wallet_cents") or 0)
    ex = int((meta or {}).get("experience_text_chars_consumed") or 0)
    if wc > 0 or ex > 0:
        append_job_event(
            job_id,
            "log",
            "已结算脚本文本费用（体验包字数与/或钱包）",
            {
                "script_chars": chars,
                "wallet_cents": wc,
                "experience_text_chars_consumed": ex,
                "tts_model": "(非TTS·脚本文本)",
            },
        )
    return dict(meta or {})


def _attach_result_audio_duration_sec(result: dict[str, Any]) -> None:
    """从 result.audio_hex（MP3 hex）写入 audio_duration_sec，与订阅用量 / 扣费 used 统计口径一致。"""
    try:
        from .audio_mix import mp3_hex_duration_sec

        d = mp3_hex_duration_sec(str(result.get("audio_hex") or ""))
        if d is not None and d > 0:
            result["audio_duration_sec"] = round(float(d), 2)
    except Exception:
        pass


def _strip_audio_hex_if_persisted_to_object_store(result: dict[str, Any]) -> None:
    """成片 MP3 已写入对象存储后从 result 移除 audio_hex，避免 JSONB 重复存放大块 hex。"""
    if str(result.get("audio_object_key") or "").strip():
        result.pop("audio_hex", None)


def _terminal_result_dict(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            j = json.loads(raw)
            return j if isinstance(j, dict) else {}
        except Exception:
            return {}
    return {}


def _enrich_result_script_notes_meta(result: dict[str, Any], payload: dict[str, Any], script_body: str) -> None:
    """写入全文字数与笔记本来源摘要，供作品列表卡片展示。"""
    body = (script_body or "").strip()
    if body:
        result["script_char_count"] = len(body)
    nb = str(payload.get("notes_notebook") or "").strip()
    sn = payload.get("selected_note_ids")
    n = sum(1 for x in (sn if isinstance(sn, list) else []) if isinstance(x, str) and str(x).strip())
    if nb:
        result["notes_source_notebook"] = nb
    if n > 0:
        result["notes_source_note_count"] = n
    titles = snapshot_notes_source_titles(payload if isinstance(payload, dict) else {})
    if titles:
        result["notes_source_titles"] = titles


_COVER_MAX_BYTES = 8 * 1024 * 1024


def _cover_host_may_require_minimax_bearer(hostname: str) -> bool:
    h = (hostname or "").strip().lower()
    if not h:
        return False
    return "minimax" in h or "minimaxi" in h


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


def _download_cover_bytes(
    cover_url: str, *, bearer_token: str | None = None
) -> tuple[bytes | None, str | None, str | None]:
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
    headers: dict[str, str] = {
        "User-Agent": "Mozilla/5.0 (compatible; Presto-CoverFetch/1.0)",
        "Accept": "image/*,*/*",
    }
    tok = (bearer_token or "").strip()
    if tok and _cover_host_may_require_minimax_bearer(parsed.hostname or ""):
        headers["Authorization"] = f"Bearer {tok}"
    try:
        resp = requests.get(u, timeout=25, stream=True, headers=headers)
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


def _persist_cover_for_job(
    job_id: str,
    created_by: Any,
    cover_url: str,
    *,
    cover_download_bearer: str | None = None,
) -> tuple[str | None, str | None, str | None]:
    raw, content_type, err = _download_cover_bytes(cover_url, bearer_token=cover_download_bearer)
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
    _ = created_by
    return int(BILLING_MAX_NOTE_REFS)


def _subscription_tier_for_job(created_by: str | None) -> str:
    _ = created_by
    return str(PRODUCT_ENTITLEMENTS_TIER).strip().lower() or "max"


def _effective_ai_polish(payload: dict[str, Any], created_by: str | None, job_id: str) -> bool:
    """客户端可传 ai_polish；以权益矩阵 tier_ai_polish_monthly_quota 为准，且功能总开关未关时生效。"""
    if not bool(payload.get("ai_polish")):
        return False
    tier = _subscription_tier_for_job(created_by)
    if tier_allows_ai_polish(tier):
        return True
    append_job_event(
        job_id,
        "log",
        "当前未开启 AI 润色（或运营已关闭 AI_POLISH_FEATURE_ENABLED），已跳过",
        {"tier": tier},
    )
    return False


def _guard_cancelled(job_id: str) -> bool:
    row = get_job(job_id)
    return bool(row and row.get("status") == "cancelled")


def _progress_heartbeat_loop(job_id: str, message: str, progress: float, stop: threading.Event) -> None:
    """长步骤无中间事件时周期性写入 progress，避免 SSE 客户端因空闲超时断开。"""
    while not stop.wait(45):
        if _guard_cancelled(job_id):
            return
        append_job_event(job_id, "progress", message, {"progress": progress})


def _start_progress_heartbeat(job_id: str, message: str, progress: float) -> tuple[threading.Event, threading.Thread]:
    stop = threading.Event()
    t = threading.Thread(
        target=_progress_heartbeat_loop,
        args=(job_id, message, progress, stop),
        daemon=True,
        name=f"job-hb-{job_id[:8]}",
    )
    t.start()
    return stop, t


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


def _payload_wants_generate_cover(payload: dict[str, Any], job_type: str) -> bool:
    """
    - script_draft + article：默认不配封面，仅显式 generate_cover=true 时生成。
    - podcast_generate / podcast + article（单人口播）：与对话模式一致，默认生成，仅显式 false 关闭。
    - 其它：未传则 True。
    """
    om = str(payload.get("output_mode") or "").strip().lower()
    jt = (job_type or "").strip().lower()
    if om == "article" and jt == "script_draft":
        return bool(payload.get("generate_cover"))
    if om == "article" and jt in ("podcast_generate", "podcast"):
        return payload.get("generate_cover") is not False
    return bool(payload.get("generate_cover", True))


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
    logger.info("rq_ai_job_run job_id=%s job_type=%s queue=ai", job_id, job_type or "?")
    source_text = str(payload.get("text") or "").strip()
    source_url = str(payload.get("url") or "").strip()
    api_key = str(os.getenv("MINIMAX_API_KEY") or "").strip() or None

    from .cover_image_material import build_cover_material
    from .legacy_bridge import script_generation_options_from_payload
    from .provider_router import (
        build_script,
        clone_voice,
        default_podcast_voice_ids,
        generate_cover_image,
        synthesize_tts,
    )
    from .reference_material import effective_article_script_target_chars, merge_reference_for_script
    from .script_reference_coverage import augment_script_options_for_multi_note_coverage
    from .tts_pipeline import run_extended_tts
    from .work_result_title import assign_work_result_title_with_optional_llm

    try:
        if job_type in ("voice_clone", "clone_voice"):
            audio_b64 = str(payload.get("audio_b64") or "").strip()
            filename = str(payload.get("filename") or "voice.wav").strip() or "voice.wav"
            display_name = str(payload.get("display_name") or "").strip() or None
            if not audio_b64:
                raise RuntimeError("缺少音频数据")
            from .media_wallet import media_wallet_billing_enabled

            pay_cents = voice_clone_payg_cents()
            clone_phone = (phone_for_job_created_by(created_by) or "").strip()
            debited = False
            if media_wallet_billing_enabled():
                if not clone_phone:
                    raise RuntimeError("单次克隆需从钱包扣费，但未找到绑定账户，请重新登录后重试")
                ok_debit, bal_after = wallet_try_debit_cents(clone_phone, pay_cents)
                if not ok_debit:
                    bal_show = max(0, bal_after) / 100.0 if bal_after >= 0 else 0.0
                    raise RuntimeError(
                        f"单次克隆需 ¥{pay_cents / 100:.2f}，钱包余额不足（当前约 ¥{bal_show:.2f}），请先充值"
                    )
                debited = True
                append_job_event(
                    job_id,
                    "log",
                    "已从钱包扣除单次克隆费用",
                    {"cents": pay_cents, "tts_model": "(非TTS·音色克隆)"},
                )
            append_job_event(job_id, "progress", "正在上传音频并克隆音色", {"progress": 60})
            try:
                audio_bytes = base64.b64decode(audio_b64)
                if len(audio_bytes) > VOICE_CLONE_MAX_BYTES:
                    raise RuntimeError("音频文件过大，最大支持 20MB")
                out = clone_voice(audio_bytes=audio_bytes, filename=filename, display_name=display_name, api_key=api_key)
            except Exception:
                if debited and clone_phone:
                    wallet_credit_cents(clone_phone, pay_cents)
                    append_job_event(job_id, "log", "克隆未成功，已退回钱包扣款", {"cents": pay_cents})
                raise
            result = {
                "voice_id": out.get("voice_id"),
                "display_name": display_name,
                "upload_trace_id": out.get("upload_trace_id"),
                "clone_trace_id": out.get("clone_trace_id"),
                "message": out.get("message"),
            }
            if not finalize_job_terminal_unless_cancelled(job_id, "succeeded", progress=100, result=result):
                if debited and clone_phone:
                    wallet_credit_cents(clone_phone, pay_cents)
                    append_job_event(job_id, "log", "任务已取消，已退回单次克隆扣款", {"cents": pay_cents})
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
            from .media_wallet import MEDIA_USAGE_PERIOD_DAYS, estimate_spoken_minutes_tts

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
            phone_m = phone_for_job_created_by(created_by)
            media_bill_meta: dict[str, Any] = {}
            est_m_voice = 0.0
            try:
                if phone_m:
                    est_m_voice = float(
                        estimate_spoken_minutes_tts(payload if isinstance(payload, dict) else {}, source_text)
                    )
                    ok_a, ass_meta = media_billing_try_assert_cover_estimated_minutes(
                        phone_m,
                        _subscription_tier_for_job(created_by),
                        est_m_voice,
                        period_days=MEDIA_USAGE_PERIOD_DAYS,
                    )
                    if not ok_a:
                        raise RuntimeError(str((ass_meta or {}).get("message") or "media billing insufficient"))

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
                    if _fm:
                        result["script_char_count"] = len(_fm)
                    if isinstance(tts.get("audio_chapters"), list):
                        result["audio_chapters"] = tts.get("audio_chapters")
                    assign_work_result_title_with_optional_llm(
                        result,
                        payload if isinstance(payload, dict) else {},
                        _fm,
                        job_type=job_type,
                        api_key=api_key,
                    )
                    if tts.get("cover_image"):
                        result["cover_image"] = tts.get("cover_image")
                        cov_key, cov_ct, cov_err = _persist_cover_for_job(
                            job_id,
                            created_by,
                            str(tts.get("cover_image") or ""),
                            cover_download_bearer=api_key,
                        )
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
                    _attach_result_audio_duration_sec(result)
                else:
                    tts = synthesize_tts(source_text, voice_id=voice_id, api_key=api_key)
                    _plain_body = (source_text or "").strip()
                    result = {
                        "audio_hex": tts.get("audio_hex"),
                        "voice_id": voice_id,
                        "trace_id": tts.get("trace_id"),
                        "upstream_status_code": tts.get("upstream_status_code"),
                        "retries": int(tts.get("retries") or 0),
                        "nonfatal_errors": tts.get("attempt_errors") or [],
                    }
                    if _plain_body:
                        result["script_char_count"] = len(_plain_body)
                    _attach_result_audio_duration_sec(result)
                    ad_sec = float(result.get("audio_duration_sec") or 0)
                    if ad_sec > 0:
                        end_ms = int(round(ad_sec * 1000))
                        result["audio_chapters"] = [{"title": "全文", "start_ms": 0, "end_ms": max(end_ms, 1)}]
                    assign_work_result_title_with_optional_llm(
                        result,
                        payload if isinstance(payload, dict) else {},
                        _plain_body,
                        job_type=job_type,
                        api_key=api_key,
                    )
                    if bool(payload.get("generate_cover", True)):
                        if not api_key:
                            append_job_event(job_id, "log", "跳过封面（未配置 MINIMAX_API_KEY）", {})
                        else:
                            _plain = (_plain_body or "").strip()
                            _pn = str(payload.get("program_name") or "").strip()
                            mat = build_cover_material(
                                script_body=_plain,
                                program_name=_pn,
                                script_constraints=str(payload.get("script_constraints") or "").strip(),
                                source_text="",
                            )
                            s = (mat or "").strip() or _plain[:4000]
                            if s:
                                ci, cerr = generate_cover_image(
                                    s,
                                    api_key,
                                    program_name_fallback=_pn,
                                )
                                if ci:
                                    result["cover_image"] = ci
                                    cov_key, cov_ct, cov_err = _persist_cover_for_job(
                                        job_id,
                                        created_by,
                                        str(ci),
                                        cover_download_bearer=api_key,
                                    )
                                    if cov_key:
                                        result["cover_object_key"] = cov_key
                                        result["cover_content_type"] = cov_ct or "image/jpeg"
                                        result["cover_image"] = f"/api/jobs/{job_id}/cover"
                                    elif cov_err:
                                        append_job_event(
                                            job_id,
                                            "log",
                                            "封面持久化失败，继续使用外链",
                                            {"detail": cov_err[:500]},
                                        )
                                elif cerr:
                                    append_job_event(
                                        job_id,
                                        "log",
                                        "封面生成未成功",
                                        {"detail": cerr[:500]},
                                    )
                if phone_m:
                    actual_sec = float(result.get("audio_duration_sec") or 0)
                    bill_m = max(0.0, actual_sec / 60.0)
                    _fb_est = est_m_voice if est_m_voice > 1e-9 else float(
                        estimate_spoken_minutes_tts(payload if isinstance(payload, dict) else {}, source_text)
                    )
                    if bill_m <= 1e-9:
                        bill_m = max(0.05, _fb_est)
                        append_job_event(
                            job_id,
                            "log",
                            "未能解析成片时长，语音费用暂按预估分钟结算",
                            {"estimated_minutes_fallback": round(_fb_est, 4)},
                        )
                    ok_m, _wcm, media_bill_meta = media_billing_try_debit_actual_minutes(
                        phone_m,
                        _subscription_tier_for_job(created_by),
                        bill_m,
                        period_days=MEDIA_USAGE_PERIOD_DAYS,
                    )
                    if not ok_m:
                        raise RuntimeError(str(media_bill_meta.get("message") or "media billing settle failed"))
                    exv = float(media_bill_meta.get("experience_voice_minutes_consumed") or 0)
                    if int(media_bill_meta.get("wallet_cents") or 0) > 0 or exv > 1e-9:
                        append_job_event(
                            job_id,
                            "log",
                            "已按实际语音时长结算体验包与/或钱包",
                            {
                                "actual_minutes": round(bill_m, 4),
                                "audio_duration_sec": round(actual_sec, 2) if actual_sec > 0 else None,
                                "estimated_minutes": round(_fb_est, 4),
                                "wallet_cents": int(media_bill_meta.get("wallet_cents") or 0),
                                "experience_voice_minutes_consumed": exv,
                                "tts_model": _wallet_ledger_tts_model_for_voice_billing(payload if isinstance(payload, dict) else {}),
                            },
                        )
                if not finalize_job_terminal_unless_cancelled(job_id, "succeeded", progress=100, result=result):
                    _refund_media_wallet_job(phone_m, media_bill_meta)
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
            except Exception:
                if phone_m:
                    _refund_media_wallet_job(phone_m, media_bill_meta)
                    append_job_event(
                        job_id,
                        "log",
                        "语音合成未成功，已退回本次套餐外扣费",
                        {"wallet_cents": int(media_bill_meta.get("wallet_cents") or 0)},
                    )
                raise

        if job_type == "note_rag_index":
            nid = str(payload.get("note_id") or "").strip()
            if not nid:
                raise RuntimeError("note_id_required")
            append_job_event(job_id, "progress", "正在为笔记建立向量索引与摘要", {"progress": 25})
            from .note_rag_service import index_note_for_rag

            out = index_note_for_rag(nid, user_ref=created_by, api_key=api_key)
            if not out.get("ok"):
                err = str(out.get("error") or "note_rag_index_failed")
                if finalize_job_terminal_unless_cancelled(job_id, "failed", progress=100, error_message=err[:500]):
                    append_job_event(job_id, "error", "笔记索引失败", {"progress": 100, "error": err[:500]})
                return {"status": "failed", "error": err}
            if not finalize_job_terminal_unless_cancelled(job_id, "succeeded", progress=100, result=out):
                append_job_event(job_id, "log", "未写入成功终态（任务已取消）", {})
                return {"status": "cancelled"}
            append_job_event(job_id, "complete", "笔记索引完成", {"progress": 100})
            return out

        append_job_event(job_id, "progress", "正在汇总参考材料（多 URL / 笔记 / 附加文本）", {"progress": 18})
        stop_ref, thr_ref = _start_progress_heartbeat(
            job_id,
            "正在汇总参考材料（检索与加载可能较慢）…",
            18.0,
        )
        try:
            source_text, ref_meta = merge_reference_for_script(
                payload, source_text, source_url, api_key, max_note_refs=note_ref_cap, user_ref=created_by
            )
        finally:
            stop_ref.set()
            thr_ref.join(timeout=2)
        append_job_event(job_id, "log", "参考材料汇总", ref_meta)

        if not source_text.strip():
            source_text = "请介绍 AI Native 应用架构"

        if _guard_cancelled(job_id):
            return {"status": "cancelled"}

        append_job_event(job_id, "progress", "正在调用模型生成脚本", {"progress": 60})
        force_fb = bool(payload.get("integration_force_fallback"))
        script_opts = augment_script_options_for_multi_note_coverage(
            payload, script_generation_options_from_payload(payload)
        )
        if script_opts.get("script_target_chars") is None:
            _st = normalize_script_target_input(payload.get("script_target_chars"))
            if _st is not None:
                script_opts["script_target_chars"] = _st
        if job_type == "script_draft" and str(payload.get("output_mode") or "").strip().lower() == "article":
            tcap = int(BILLING_LONG_FORM_SCRIPT_CHARS_CAP)
            raw_tc = script_opts.get("script_target_chars")
            if raw_tc is not None:
                try:
                    req_int = int(raw_tc)
                except (TypeError, ValueError):
                    req_int = 2000
                adj = effective_article_script_target_chars(
                    req_int,
                    merged_chars=len(source_text.strip()),
                    notes_loaded=int(ref_meta.get("notes_loaded") or 0),
                    tier_cap=tcap,
                )
                if adj != req_int:
                    append_job_event(
                        job_id,
                        "log",
                        "文章目标字数已按参考材料规模调整",
                        {"requested": req_int, "effective": adj, "merged_chars": len(source_text.strip())},
                    )
                script_opts["script_target_chars"] = adj

        stop_scr, thr_scr = _start_progress_heartbeat(
            job_id,
            "正在调用模型生成脚本（长稿可能较久）…",
            60.0,
        )
        try:
            gen = build_script(
                source_text,
                api_key=api_key,
                force_fallback=force_fb,
                script_options=script_opts,
                on_script_delta=_make_script_delta_handler(job_id),
                subscription_tier=_subscription_tier_for_job(created_by),
            )
        finally:
            stop_scr.set()
            thr_scr.join(timeout=2)
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
        _enrich_result_script_notes_meta(result, payload if isinstance(payload, dict) else {}, script)
        if _payload_wants_generate_cover(payload, job_type) and api_key:
            _pn = str(payload.get("program_name") or "").strip()
            mat = build_cover_material(
                script_body=(script or ""),
                program_name=_pn,
                script_constraints=str(payload.get("script_constraints") or "").strip(),
                source_text=str(payload.get("text") or "").strip(),
            )
            mat_use = (mat or "").strip() or (script or "").strip()[:4000]
            ci, cerr = generate_cover_image(mat_use, api_key, program_name_fallback=_pn)
            if ci:
                result["cover_image"] = ci
                cov_key, cov_ct, cov_err = _persist_cover_for_job(
                    job_id, created_by, str(ci), cover_download_bearer=api_key
                )
                if cov_key:
                    result["cover_object_key"] = cov_key
                    result["cover_content_type"] = cov_ct or "image/jpeg"
                    result["cover_image"] = f"/api/jobs/{job_id}/cover"
                elif cov_err:
                    append_job_event(job_id, "log", "封面持久化失败，继续使用外链", {"detail": cov_err[:500]})
            elif cerr:
                append_job_event(job_id, "log", "封面生成未完全成功", {"detail": cerr[:500]})
        elif _payload_wants_generate_cover(payload, job_type) and not api_key:
            append_job_event(job_id, "log", "跳过封面（未配置 MINIMAX_API_KEY）", {})
        assign_work_result_title_with_optional_llm(
            result,
            payload if isinstance(payload, dict) else {},
            script,
            job_type=job_type,
            api_key=api_key,
        )
        text_bill_meta_script = _debit_script_text_billing_or_raise(job_id, created_by, script)
        if not finalize_job_terminal_unless_cancelled(job_id, "succeeded", progress=100, result=result):
            ph_can = (phone_for_job_created_by(created_by) or "").strip()
            if text_bill_meta_script and ph_can:
                script_text_billing_refund(ph_can, text_bill_meta_script)
                append_job_event(job_id, "log", "任务已取消，已退回脚本文本扣费（体验包与/或钱包）", text_bill_meta_script)
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
    job_type = str(job.get("job_type") or "").strip().lower()
    logger.info("rq_media_job_run job_id=%s job_type=%s queue=media", job_id, job_type or "?")
    source_text = str(payload.get("text") or "").strip()
    source_url = str(payload.get("url") or "").strip()
    api_key = str(os.getenv("MINIMAX_API_KEY") or "").strip() or None

    from .audio_mix import maybe_mix_podcast_bgm
    from .cover_image_material import build_cover_material
    from .legacy_bridge import script_generation_options_from_payload
    from .object_store import presigned_get_url
    from .provider_router import (
        build_script,
        default_podcast_voice_ids,
        generate_cover_image,
        synthesize_tts,
    )
    from .reference_material import merge_reference_for_script
    from .script_reference_coverage import augment_script_options_for_multi_note_coverage
    from .tts_pipeline import (
        dialogue_speaker_format_issues,
        normalize_dialogue_speaker_lines,
        run_extended_tts,
    )
    from .work_result_title import assign_work_result_title_with_optional_llm

    try:
        if job_type == "podcast_short_video":
            err = "短视频合成功能已移除，无法执行该任务。"
            logger.warning("podcast_short_video removed job_id=%s", job_id)
            if finalize_job_terminal_unless_cancelled(job_id, "failed", progress=100, error_message=err[:500]):
                append_job_event(job_id, "error", err, {"progress": 100})
            return {"status": "failed", "error": err}

        if job_type in ("podcast_generate", "podcast"):
            podcast_text_bill_meta: dict[str, Any] = {}
            resynth_only = bool(payload.get("resynth_audio_only"))
            forced_script = str(payload.get("resynth_script_text") or "").strip()
            if resynth_only and forced_script:
                append_job_event(
                    job_id,
                    "progress",
                    "使用已编辑口播稿，跳过参考合并与撰稿模型",
                    {"progress": 22},
                )
                script = forced_script
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
                append_job_event(job_id, "progress", "口播稿已就绪，正在上传并准备语音合成…", {"progress": 55})
                _mbase = job_artifact_base(job_id, _storage_owner_uuid(job.get("created_by")))
                script_key = f"{_mbase}/podcast_script.txt"
                upload_text(script_key, script)
                add_artifact(job_id, "script", script_key)
            else:
                append_job_event(job_id, "progress", "正在汇总参考材料（多 URL / 笔记 / 附加文本）", {"progress": 18})
                stop_ref, thr_ref = _start_progress_heartbeat(
                    job_id,
                    "正在汇总参考材料（检索与加载可能较慢）…",
                    18.0,
                )
                try:
                    source_text, ref_meta = merge_reference_for_script(
                        payload, source_text, source_url, api_key, max_note_refs=note_ref_cap, user_ref=created_by
                    )
                finally:
                    stop_ref.set()
                    thr_ref.join(timeout=2)
                append_job_event(job_id, "log", "参考材料汇总", ref_meta)
                if not source_text.strip():
                    source_text = "请生成一段 AI Native 播客稿件。"

                append_job_event(job_id, "progress", "正在生成播客脚本", {"progress": 45})
                force_fb = bool(payload.get("integration_force_fallback"))
                stop_scr, thr_scr = _start_progress_heartbeat(
                    job_id,
                    "正在生成播客脚本（长稿可能较久）…",
                    45.0,
                )
                try:
                    gen = build_script(
                        source_text,
                        api_key=api_key,
                        force_fallback=force_fb,
                        script_options=augment_script_options_for_multi_note_coverage(
                            payload, script_generation_options_from_payload(payload)
                        ),
                        on_script_delta=_make_script_delta_handler(job_id),
                        subscription_tier=_subscription_tier_for_job(created_by),
                    )
                finally:
                    stop_scr.set()
                    thr_scr.join(timeout=2)
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
            gen_cover = _payload_wants_generate_cover(payload, job_type)

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
                    # 默认 9000：减少 TTS 往返（≤ 同步单段上限）；可通过 payload 覆盖
                    "tts_max_chunk_chars": 9000,
                }
                _mc = payload.get("tts_max_chunk_chars")
                if _mc is not None and str(_mc).strip() != "":
                    tts_pl["tts_max_chunk_chars"] = _mc
            else:
                # 双人成片：默认禁止「分段过多→单人快速合成」降级，否则长对话只听得到一种音色。
                # 需极限省时可由 payload.auto_degrade_tts=true 显式开启。
                tts_pl = {
                    "text": script,
                    "tts_mode": "dual",
                    "voice_id_1": voice_id_1,
                    "voice_id_2": voice_id_2,
                    "intro_text": intro_text,
                    "outro_text": outro_text,
                    "generate_cover": gen_cover,
                    "auto_degrade_tts": bool(payload.get("auto_degrade_tts", False)),
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
            tts_pl["cover_program_name"] = str(payload.get("program_name") or "").strip()
            tts_pl["cover_script_constraints"] = str(payload.get("script_constraints") or "").strip()
            tts_pl["cover_source_text"] = str(payload.get("text") or "").strip()
            _want_polish = _effective_ai_polish(payload, created_by, job_id)
            tts_pl["ai_polish"] = _want_polish
            # 脚本已在生成阶段注入 TTS 口语约束；开启 AI 润色时默认跳过正文二次文本润色（force_tts_text_polish_main 可强制再润色）
            tts_pl["skip_model_polish_main"] = bool(_want_polish) and not bool(
                payload.get("force_tts_text_polish_main", False)
            )

            from .media_wallet import MEDIA_USAGE_PERIOD_DAYS, estimate_spoken_minutes_tts

            phone_pm = phone_for_job_created_by(created_by)
            media_bill_meta: dict[str, Any] = {}
            est_m_voice_pod = 0.0
            if phone_pm:
                est_m_voice_pod = float(estimate_spoken_minutes_tts(tts_pl, script))
                ok_a, ass_meta = media_billing_try_assert_cover_estimated_minutes(
                    phone_pm,
                    _subscription_tier_for_job(created_by),
                    est_m_voice_pod,
                    period_days=MEDIA_USAGE_PERIOD_DAYS,
                )
                if not ok_a:
                    raise RuntimeError(str((ass_meta or {}).get("message") or "media billing insufficient"))
            if not (resynth_only and forced_script):
                podcast_text_bill_meta = _debit_script_text_billing_or_raise(job_id, created_by, script)

            try:

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
                if isinstance(tts.get("audio_chapters"), list):
                    result["audio_chapters"] = tts.get("audio_chapters")
                if tts.get("cover_image"):
                    result["cover_image"] = tts.get("cover_image")
                    cov_key, cov_ct, cov_err = _persist_cover_for_job(
                        job_id,
                        created_by,
                        str(tts.get("cover_image") or ""),
                        cover_download_bearer=api_key,
                    )
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
                # 合成阶段文生图失败时，用与 script_draft 相同的素材摘要再试一次（含开场/收场，关联度更好）
                if gen_cover and api_key:
                    _has_cov = bool(str(result.get("cover_image") or "").strip()) or bool(
                        str(result.get("cover_object_key") or "").strip()
                    )
                    if not _has_cov:
                        _pn_fb = str(payload.get("program_name") or "").strip()
                        _mat = build_cover_material(
                            script_body=script_after_tts or script,
                            intro=_it or "",
                            outro=_ot or "",
                            program_name=_pn_fb,
                            script_constraints=str(payload.get("script_constraints") or "").strip(),
                            source_text=str(payload.get("text") or "").strip(),
                        )
                        _mat_use = (_mat or "").strip() or (script_after_tts or script or "").strip()[:4000]
                        if _mat_use:
                            ci2, cerr2 = generate_cover_image(_mat_use, api_key, program_name_fallback=_pn_fb)
                            if ci2:
                                result["cover_image"] = ci2
                                cov_key2, cov_ct2, cov_err2 = _persist_cover_for_job(
                                    job_id,
                                    created_by,
                                    str(ci2),
                                    cover_download_bearer=api_key,
                                )
                                if cov_key2:
                                    result["cover_object_key"] = cov_key2
                                    result["cover_content_type"] = cov_ct2 or "image/jpeg"
                                    result["cover_image"] = f"/api/jobs/{job_id}/cover"
                                elif cov_err2:
                                    append_job_event(
                                        job_id,
                                        "log",
                                        "封面持久化失败，继续使用外链",
                                        {"detail": cov_err2[:500]},
                                    )
                            elif cerr2:
                                append_job_event(
                                    job_id,
                                    "log",
                                    "成片补生成封面未成功",
                                    {"detail": cerr2[:500]},
                                )
                _enrich_result_script_notes_meta(result, payload if isinstance(payload, dict) else {}, script_after_tts)
                _attach_result_audio_duration_sec(result)
                _hx_ep = str(result.get("audio_hex") or "").strip()
                if _hx_ep and len(_hx_ep) % 2 == 0:
                    try:
                        _raw_mp3 = bytes.fromhex(_hx_ep)
                        if _raw_mp3:
                            _ep_key = f"{_mbase}/episode_audio.mp3"
                            upload_bytes(_ep_key, _raw_mp3, "audio/mpeg")
                            result["audio_object_key"] = _ep_key
                            result["audio_url"] = presigned_get_url(_ep_key, expires_in=86400 * 7)
                            _strip_audio_hex_if_persisted_to_object_store(result)
                    except Exception as _up_exc:
                        append_job_event(
                            job_id,
                            "log",
                            "成片 MP3 写入对象存储失败，RSS 仍可能依赖 audio_hex",
                            {"detail": str(_up_exc)[:240]},
                        )
                assign_work_result_title_with_optional_llm(
                    result,
                    payload if isinstance(payload, dict) else {},
                    script_after_tts,
                    job_type=job_type,
                    api_key=api_key,
                )
                if phone_pm:
                    actual_sec = float(result.get("audio_duration_sec") or 0)
                    bill_m = max(0.0, actual_sec / 60.0)
                    _fb_est = est_m_voice_pod if est_m_voice_pod > 1e-9 else float(
                        estimate_spoken_minutes_tts(tts_pl, script_after_tts or script)
                    )
                    if bill_m <= 1e-9:
                        bill_m = max(0.05, _fb_est)
                        append_job_event(
                            job_id,
                            "log",
                            "未能解析成片时长，语音费用暂按预估分钟结算",
                            {"estimated_minutes_fallback": round(_fb_est, 4)},
                        )
                    ok_m, _wcm, media_bill_meta = media_billing_try_debit_actual_minutes(
                        phone_pm,
                        _subscription_tier_for_job(created_by),
                        bill_m,
                        period_days=MEDIA_USAGE_PERIOD_DAYS,
                    )
                    if not ok_m:
                        raise RuntimeError(str(media_bill_meta.get("message") or "media billing settle failed"))
                    exv2 = float(media_bill_meta.get("experience_voice_minutes_consumed") or 0)
                    if int(media_bill_meta.get("wallet_cents") or 0) > 0 or exv2 > 1e-9:
                        append_job_event(
                            job_id,
                            "log",
                            "已按实际语音时长结算体验包与/或钱包",
                            {
                                "actual_minutes": round(bill_m, 4),
                                "audio_duration_sec": round(actual_sec, 2) if actual_sec > 0 else None,
                                "estimated_minutes": round(_fb_est, 4),
                                "wallet_cents": int(media_bill_meta.get("wallet_cents") or 0),
                                "experience_voice_minutes_consumed": exv2,
                                "tts_model": _wallet_ledger_tts_model_for_voice_billing(tts_pl),
                            },
                        )
                if not finalize_job_terminal_unless_cancelled(job_id, "succeeded", progress=100, result=result):
                    _refund_media_wallet_job(phone_pm, media_bill_meta)
                    append_job_event(job_id, "log", "未写入成功终态（任务已取消）", {})
                    return {"status": "cancelled"}
                append_job_event(job_id, "complete", "播客生成完成", {"progress": 100, "trace_id": result.get("trace_id")})
                return result
            except Exception:
                if phone_pm:
                    _refund_media_wallet_job(phone_pm, media_bill_meta)
                    append_job_event(
                        job_id,
                        "log",
                        "播客语音合成未成功，已退回本次套餐外扣费",
                        {"wallet_cents": int(media_bill_meta.get("wallet_cents") or 0)},
                    )
                if podcast_text_bill_meta:
                    ph_r = (phone_for_job_created_by(created_by) or "").strip()
                    if ph_r:
                        script_text_billing_refund(ph_r, podcast_text_bill_meta)
                        append_job_event(
                            job_id,
                            "log",
                            "播客流程异常，已退回脚本文本扣费（体验包与/或钱包）",
                            {"wallet_cents": int(podcast_text_bill_meta.get("wallet_cents") or 0)},
                        )
                raise

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


def _clip_owner_uuid_str(uid: Any) -> str | None:
    if uid is None:
        return None
    s = str(uid).strip()
    return s or None


def run_clip_transcription_job(project_id: str) -> dict[str, Any]:
    from pathlib import Path

    from .clip_audio_merge import ffprobe_audio_channels
    from .clip_store import (
        get_clip_project_by_id,
        try_claim_clip_transcription_queued,
        update_clip_project_meta,
        update_clip_transcribe_failed,
        update_clip_transcribe_queued,
        update_clip_transcribe_succeeded,
    )
    from .clip_transcript_refine import refine_transcript_two_stage
    from .clip_transcript_normalize import normalize_volc_flash_transcript
    from .object_store import get_object_bytes, presigned_get_url
    from .volcengine_seed_asr_client import volc_seed_recognize_url_wait

    pid = (project_id or "").strip()
    if not pid:
        return {"status": "skipped", "error": "empty_project_id"}
    row = get_clip_project_by_id(pid)
    if not row:
        return {"status": "failed", "error": "project_not_found"}
    owner = _clip_owner_uuid_str(row.get("user_id"))
    t_st = str(row.get("transcription_status") or "").strip() or "idle"
    logger.info("clip transcribe worker_start project_id=%s transcription_status=%s", pid, t_st)
    if t_st == "succeeded" and row.get("transcript_normalized"):
        return {"status": "skipped", "reason": "already_succeeded"}
    if t_st == "running":
        return {"status": "skipped", "reason": "already_running"}
    if t_st in ("idle", "failed"):
        if not try_claim_clip_transcription_queued(project_id=pid, user_uuid=owner):
            return {"status": "skipped", "reason": "transcription_claim_failed"}
    elif t_st != "queued":
        return {"status": "skipped", "reason": "unexpected_transcription_status"}
    audio_key = str(row.get("audio_object_key") or "").strip()
    if not audio_key:
        update_clip_transcribe_failed(project_id=pid, user_uuid=owner, message="未上传音频")
        return {"status": "failed", "error": "no_audio"}

    try:
        audio_bytes = get_object_bytes(audio_key)
    except Exception as exc:
        update_clip_transcribe_failed(project_id=pid, user_uuid=owner, message=f"读取音频失败: {exc}")
        return {"status": "failed", "error": "read_audio"}

    try:
        import tempfile

        suf = Path(str(row.get("audio_filename") or "clip.bin")).suffix or ".bin"
        with tempfile.NamedTemporaryFile(prefix="fyv_clip_tr_probe_", suffix=suf, delete=True) as tf:
            tf.write(audio_bytes)
            tf.flush()
            nch = ffprobe_audio_channels(Path(tf.name))
            ch_auto = [0, 1] if nch >= 2 else [0]
            update_clip_project_meta(project_id=pid, user_uuid=owner, channel_ids=ch_auto)
            row = get_clip_project_by_id(pid) or row
            logger.info("clip transcribe channel_autodetect project_id=%s channels=%s", pid, nch)
    except Exception as probe_exc:
        logger.warning("clip transcribe channel_autodetect_failed project_id=%s err=%s", pid, probe_exc)

    max_inline_raw = int(os.getenv("CLIP_VOLC_SEED_MAX_INLINE_BYTES") or str(80 * 1024 * 1024))
    max_inline = max(1024 * 1024, min(200 * 1024 * 1024, max_inline_raw))
    file_url = ""
    submit_bytes: bytes | None = None
    if len(audio_bytes) <= max_inline:
        submit_bytes = audio_bytes
        logger.info(
            "clip transcribe volc_seed_inline_bytes project_id=%s bytes=%s max_inline=%s",
            pid,
            len(audio_bytes),
            max_inline,
        )
    else:
        exp = int(os.getenv("CLIP_AUDIO_PRESIGNED_EXPIRES_SEC") or os.getenv("FUNASR_PRESIGNED_EXPIRES_SEC") or "172800")
        exp = max(300, min(604800, exp))
        try:
            file_url = presigned_get_url(audio_key, expires_in=exp)
        except Exception as exc:
            update_clip_transcribe_failed(project_id=pid, user_uuid=owner, message=f"生成访问 URL 失败: {exc}")
            return {"status": "failed", "error": "presign"}
        logger.warning(
            "clip transcribe volc_seed_url_only project_id=%s bytes=%s exceeds CLIP_VOLC_SEED_MAX_INLINE_BYTES=%s; "
            "豆包需能公网下载该预签名 URL（内网 MinIO 请调大阈值或配置 OBJECT_PRESIGN_ENDPOINT）",
            pid,
            len(audio_bytes),
            max_inline,
        )

    diar = bool(row.get("diarization_enabled", True))
    ch_raw = row.get("channel_ids")
    channel_ids: list[int] | None = None
    if isinstance(ch_raw, list):
        channel_ids = []
        for x in ch_raw:
            try:
                channel_ids.append(int(x))
            except (TypeError, ValueError):
                continue
        if not channel_ids:
            channel_ids = [0]
    elif isinstance(ch_raw, str) and ch_raw.strip():
        try:
            parsed = json.loads(ch_raw)
            if isinstance(parsed, list) and parsed:
                channel_ids = [int(x) for x in parsed]
        except Exception:
            channel_ids = None
    if not channel_ids:
        channel_ids = [0]

    try:
        import uuid as _uuid

        volc_tid = f"volc-seed-{_uuid.uuid4().hex[:20]}"
        update_clip_transcribe_queued(project_id=pid, user_uuid=owner, task_id=volc_tid)
        logger.info("clip transcribe volc_seed_start project_id=%s pseudo_task_id=%s", pid, volc_tid)
        hw_raw = row.get("asr_corpus_hotwords") or []
        if isinstance(hw_raw, str):
            try:
                hw_raw = json.loads(hw_raw)
            except Exception:
                hw_raw = []
        corpus_hw: list[str] = []
        if isinstance(hw_raw, list):
            for x in hw_raw:
                s = str(x).strip()
                if s:
                    corpus_hw.append(s)
        sc_raw = row.get("asr_corpus_scene")
        corpus_scene = (
            str(sc_raw).strip() if isinstance(sc_raw, str) and str(sc_raw).strip() else None
        )

        raw_tr = volc_seed_recognize_url_wait(
            file_url=file_url,
            audio_bytes=submit_bytes,
            diarization_enabled=diar,
            channel_ids=channel_ids,
            audio_filename=str(row.get("audio_filename") or "").strip() or None,
            audio_mime=str(row.get("audio_mime") or "").strip() or None,
            corpus_hotwords=corpus_hw if corpus_hw else None,
            corpus_scene=corpus_scene,
        )
        try:
            normalized, refine_meta = refine_transcript_two_stage(
                raw_transcript=raw_tr,
                audio_bytes=audio_bytes,
                audio_filename=str(row.get("audio_filename") or "").strip() or None,
                audio_mime=str(row.get("audio_mime") or "").strip() or None,
                diarization_enabled=diar,
                speaker_hint=int(row.get("speaker_count") or 2),
                channel_ids=channel_ids,
                corpus_hotwords=corpus_hw if corpus_hw else None,
                corpus_scene=corpus_scene,
            )
            logger.info("clip transcribe second_stage project_id=%s meta=%s", pid, refine_meta)
        except Exception as refine_exc:
            logger.warning("clip transcribe second_stage_failed project_id=%s err=%s", pid, refine_exc)
            normalized = normalize_volc_flash_transcript(
                raw_tr,
                profile="auto",
                speaker_hint=int(row.get("speaker_count") or 2),
            )
        update_clip_transcribe_succeeded(project_id=pid, user_uuid=owner, raw=raw_tr, normalized=normalized)
        return {"status": "succeeded", "word_count": len(normalized.get("words") or [])}
    except Exception as exc:
        msg = str(exc) or "transcribe_failed"
        update_clip_transcribe_failed(project_id=pid, user_uuid=owner, message=msg)
        logger.exception("clip transcribe failed project_id=%s", pid)
        return {"status": "failed", "error": msg}


def run_clip_export_job(project_id: str) -> dict[str, Any]:
    from .clip_export import export_clip_mp3_from_bytes, resolve_export_loudnorm_i_lufs
    from .clip_store import (
        get_clip_project_by_id,
        try_claim_clip_export_queued,
        update_clip_export_failed,
        update_clip_export_running,
        update_clip_export_succeeded,
    )
    from .object_store import get_object_bytes, upload_bytes

    pid = (project_id or "").strip()
    row = get_clip_project_by_id(pid)
    if not row:
        return {"status": "failed", "error": "project_not_found"}
    owner = _clip_owner_uuid_str(row.get("user_id"))
    ex_st = str(row.get("export_status") or "").strip() or "idle"
    logger.info("clip export worker_start project_id=%s export_status=%s", pid, ex_st)
    if str(row.get("transcription_status") or "") != "succeeded":
        update_clip_export_failed(project_id=pid, user_uuid=owner, message="转写未完成，无法导出")
        return {"status": "failed", "error": "not_transcribed"}
    if ex_st == "running":
        return {"status": "skipped", "reason": "export_already_running"}
    if ex_st in ("idle", "failed", "succeeded"):
        if not try_claim_clip_export_queued(project_id=pid, user_uuid=owner):
            return {"status": "skipped", "reason": "export_claim_failed"}
    elif ex_st != "queued":
        return {"status": "skipped", "reason": "unexpected_export_status"}
    norm = row.get("transcript_normalized")
    if isinstance(norm, str):
        try:
            norm = json.loads(norm)
        except Exception:
            norm = {}
    if not isinstance(norm, dict):
        update_clip_export_failed(project_id=pid, user_uuid=owner, message="缺少归一化文稿")
        return {"status": "failed", "error": "no_transcript"}

    ex = row.get("excluded_word_ids")
    if isinstance(ex, str):
        try:
            ex = json.loads(ex)
        except Exception:
            ex = []
    excluded = {str(x) for x in (ex if isinstance(ex, list) else [])}

    if not update_clip_export_running(project_id=pid, user_uuid=owner):
        return {"status": "skipped", "reason": "export_running_guard"}

    audio_key = str(row.get("audio_object_key") or "").strip()
    try:
        merge_gap_ms = max(0, int(os.getenv("CLIP_EXPORT_MERGE_GAP_MS") or "120"))
    except (TypeError, ValueError):
        merge_gap_ms = 120
    pol_raw = row.get("export_pause_policy")
    if isinstance(pol_raw, str):
        try:
            pol_raw = json.loads(pol_raw)
        except Exception:
            pol_raw = None
    long_pause_ms = 0
    long_pause_cap_ms = 500
    if isinstance(pol_raw, dict) and bool(pol_raw.get("enabled")):
        try:
            long_pause_ms = max(0, int(pol_raw.get("long_gap_ms", 2000)))
            long_pause_cap_ms = max(50, min(5000, int(pol_raw.get("cap_ms", 500))))
        except (TypeError, ValueError):
            long_pause_ms, long_pause_cap_ms = 0, 500
    silence_cuts: list[tuple[int, int, int]] = []
    tl_raw = row.get("timeline_json")
    if isinstance(tl_raw, str):
        try:
            tl_raw = json.loads(tl_raw)
        except Exception:
            tl_raw = None
    if isinstance(tl_raw, dict):
        cuts_raw = tl_raw.get("silence_cuts")
        if isinstance(cuts_raw, list):
            for it in cuts_raw:
                if not isinstance(it, dict):
                    continue
                try:
                    s = int(it.get("start_ms"))
                    e = int(it.get("end_ms"))
                except (TypeError, ValueError):
                    continue
                if e > s:
                    try:
                        cap = int(it.get("cap_ms")) if it.get("cap_ms") is not None else 0
                    except (TypeError, ValueError):
                        cap = 0
                    silence_cuts.append((s, e, max(0, min(10_000, cap))))
    try:
        b = get_object_bytes(audio_key)
        out = export_clip_mp3_from_bytes(
            audio_bytes=b,
            normalized=norm,
            excluded_word_ids=excluded,
            merge_gap_ms=merge_gap_ms,
            long_pause_ms=long_pause_ms,
            long_pause_cap_ms=long_pause_cap_ms,
            silence_cut_ranges=silence_cuts,
            loudnorm_i_lufs=resolve_export_loudnorm_i_lufs(row.get("repair_loudness_i_lufs")),
        )
        out_key = f"clip/{owner or 'anon'}/{pid}/export.mp3"
        upload_bytes(out_key, out, "audio/mpeg")
        update_clip_export_succeeded(project_id=pid, user_uuid=owner, export_key=out_key)
        return {"status": "succeeded", "export_object_key": out_key}
    except Exception as exc:
        msg = str(exc) or "export_failed"
        update_clip_export_failed(project_id=pid, user_uuid=owner, message=msg)
        logger.exception("clip export failed project_id=%s", pid)
        return {"status": "failed", "error": msg}

import logging
import os
import re
import tempfile
import time
from typing import Any, Callable, Iterator

from app.fyv_shared.config import DEFAULT_VOICES, PODCAST_CONFIG
from app.fyv_shared.content_parser import content_parser

from .entitlement_matrix import normalize_script_target_input
from .script_reference_coverage import article_outline_min_chars_threshold, count_selected_notes

logger = logging.getLogger(__name__)

# 与 legacy 播客生成表单默认 script_constraints 一致（双人播客）
DEFAULT_SCRIPT_CONSTRAINTS_DIALOGUE = (
    "对话内容中不能包含（笑）（停顿）（思考）等动作、心理活动或场景描述，只生成纯对话文本。"
)
# 续写轮次：与 MiniMax generate_script_stream 第二段起一致，强化行首 Speaker 格式（OpenAI 兼容路径复用）
DIALOGUE_SPEAKER_RETRY_CONSTRAINTS = (
    "必须输出双人对话；每行以 Speaker1: 或 Speaker2: 开头，一行一句。"
    "台词正文不要出现英文 Speaker、Mini、Max 等标签字样。"
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


def _podcast_cfg_int(key: str, default: int) -> int:
    try:
        return int(PODCAST_CONFIG.get(key, default))
    except (TypeError, ValueError):
        return default


def _podcast_cfg_float(key: str, default: float) -> float:
    try:
        return float(PODCAST_CONFIG.get(key, default))
    except (TypeError, ValueError):
        return default


def _script_continuation_tail(script_so_far: str, tail_max: int) -> str:
    t = (script_so_far or "").strip()
    if len(t) <= tail_max:
        return t
    return t[-tail_max:]


def _article_outline_first_enabled() -> bool:
    return (os.getenv("ARTICLE_OUTLINE_FIRST", "1") or "").strip().lower() not in ("0", "false", "no")


def _article_continuation_progress_summary(script_so_far: str, *, max_heading_lines: int = 14) -> str:
    """长文续写：用字数 + 已出现的 Markdown 标题做轻量进展摘要，降低后段跑题。"""
    t = (script_so_far or "").strip()
    if not t:
        return ""
    n_chars = len(t)
    headings: list[str] = []
    for ln in t.splitlines():
        s = ln.strip()
        if s.startswith("#"):
            headings.append(s[:160])
        if len(headings) >= max_heading_lines:
            break
    head_block = "\n".join(headings) if headings else ""
    if head_block:
        return (
            f"【写作进展摘要】已生成约 {n_chars} 字；以下为已出现标题脉络（勿重复展开，请顺势接续）：\n"
            f"{head_block}"
        )
    return f"【写作进展摘要】已生成约 {n_chars} 字；请紧接末段语义续写，勿重复开篇。"


def merge_script_continuation_material(
    base_ref: str,
    script_so_far: str,
    *,
    tail_max: int,
    reference_tail_max: int,
    output_mode: str = "dialogue",
    article_outline_block: str = "",
    article_progress_summary: str = "",
) -> str:
    """在参考材料后附加「已生成上文」，供第二轮及后续续写。参考书极长时截末尾，减轻第三轮起拒写/空返。"""
    ref = (base_ref or "").rstrip()
    rtm = max(0, int(reference_tail_max))
    if rtm > 0 and len(ref) > rtm:
        ref = (
            f"【参考材料节选·全文较长已截取末尾约 {rtm} 字，供衔接事实与术语】\n"
            f"{ref[-rtm:]}"
        )
    om = (output_mode or "dialogue").strip().lower()
    ao = (article_outline_block or "").strip()
    aps = (article_progress_summary or "").strip()
    blocks: list[str] = []
    if ref:
        blocks.append(ref)
    if om == "article" and ao:
        blocks.append(f"【写作提纲·正文须按此脉络展开】\n{ao}")
    if om == "article" and aps:
        blocks.append(aps)
    tail = _script_continuation_tail(script_so_far, tail_max)
    tail_note = ""
    if om == "article":
        tail_note = (
            "非全文末段时禁止播客式结语（如「感谢收听」「感谢你的收听」「我们下次再见」）；"
            "须像同一篇文章的中段自然延伸。"
        )
    blocks.append(
        f"【已生成上文】\n{tail}\n\n"
        "（请紧接上文最后一两句续写：首句须自然承接上文语义与指代；不要重复已有段落；"
        "不要重新写开篇套话或再介绍一遍主题；不要输出「续写」「下一段」等编排标记。"
        f"{tail_note}）"
    )
    return "\n\n".join(blocks)


def _join_script_continued(accumulated: str, piece: str, output_mode: str) -> str:
    a = accumulated.rstrip()
    p = piece.lstrip()
    if not p:
        return accumulated
    sep = "\n" if output_mode == "dialogue" else "\n\n"
    return a + sep + p


def _consume_minimax_script_stream(
    stream_it: Iterator[dict[str, Any]],
    *,
    on_script_delta: Callable[[str, str], None] | None,
    accumulated_prefix: str,
) -> tuple[str, str | None, str | None]:
    """
    消费 generate_script_stream 事件。
    返回 (本轮正文, finish_reason, 最后一帧 trace_id)。
    on_script_delta 收到的是 accumulated_prefix + 本轮已拼片段。
    """
    chunks: list[str] = []
    finish_reason: str | None = None
    last_trace: str | None = None
    for ev in stream_it:
        tid = ev.get("trace_id")
        if tid:
            last_trace = str(tid)
        if ev.get("type") == "script_chunk":
            c = str(ev.get("content") or "")
            chunks.append(c)
            if on_script_delta:
                on_script_delta(accumulated_prefix + "".join(chunks), c)
        elif ev.get("type") == "error":
            raise RuntimeError(str(ev.get("message") or "script_generation_failed"))
        elif ev.get("type") == "script_complete":
            finish_reason = str(ev.get("finish_reason") or "stop")
    piece = "".join(chunks).strip()
    return piece, finish_reason, last_trace


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


def generate_cover_image_tts_result(
    summary: str,
    api_key: str | None,
    *,
    program_name_fallback: str = "",
) -> tuple[str | None, str | None]:
    """文生图封面：成功返回 (url, None)，失败返回 (None, 简短原因)。"""
    if not api_key:
        return None, "未配置 MINIMAX_API_KEY"
    s = (summary or "").strip()
    if not s:
        return None, "摘要为空，跳过封面"
    try:
        from app.fyv_shared.minimax_client import minimax_client

        cr = minimax_client.generate_cover_image(
            s[:4000],
            api_key=api_key,
            program_name_fallback=(program_name_fallback or "").strip(),
        )
        if cr.get("success") and cr.get("image_url"):
            return str(cr["image_url"]), None
        err = str(cr.get("error") or cr.get("message") or "上游未返回 image_url")
        return None, err[:400]
    except Exception as exc:
        logger.warning("generate_cover_image_tts: %s", exc)
        return None, str(exc)[:400]


def generate_cover_image_tts(summary: str, api_key: str | None) -> str | None:
    """文生图封面（失败则返回 None）。"""
    url, _ = generate_cover_image_tts_result(summary, api_key, program_name_fallback="")
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
        "core_question",
    ):
        v = payload.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()
    n = normalize_script_target_input(payload.get("script_target_chars"))
    if n is not None:
        out["script_target_chars"] = n
    if "oral_for_tts" in payload:
        out["oral_for_tts"] = bool(payload.get("oral_for_tts"))
    _sn = count_selected_notes(payload)
    if _sn > 0:
        out["selected_note_count"] = _sn
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

    # 与 legacy 播客生成及 minimax_client.generate_script_stream 默认一致（本期播客）
    script_style = str(opts.get("script_style") or "轻松幽默，自然流畅").strip()
    script_language = str(opts.get("script_language") or "中文").strip()
    program_name = str(opts.get("program_name") or "本期播客").strip()
    speaker1 = str(opts.get("speaker1_persona") or "活泼亲切，引导话题").strip()
    speaker2 = str(opts.get("speaker2_persona") or "稳重专业，深度分析").strip()
    output_mode = str(opts.get("output_mode") or "dialogue").strip().lower()
    if output_mode not in ("dialogue", "article"):
        output_mode = "dialogue"

    core_q = str(opts.get("core_question") or "").strip()
    try:
        selected_note_count = int(opts.get("selected_note_count") or 0)
    except (TypeError, ValueError):
        selected_note_count = 0

    user_c = str(opts.get("script_constraints") or "").strip()
    # 双人：未显式传约束时使用默认双人约束；文章：空约束交给 minimax_client →「无额外约束」
    if output_mode == "article":
        first_constraints = user_c
    else:
        first_constraints = user_c if user_c else DEFAULT_SCRIPT_CONSTRAINTS_DIALOGUE
    if output_mode == "article":
        attempts = [
            {"target_chars": base, "script_constraints": first_constraints},
            {"target_chars": max(200, base - 200), "script_constraints": ""},
            {"target_chars": max(200, base - 400), "script_constraints": ""},
        ]
    else:
        attempts = [
            {"target_chars": base, "script_constraints": first_constraints},
            {"target_chars": max(200, base - 200), "script_constraints": DIALOGUE_SPEAKER_RETRY_CONSTRAINTS},
            {"target_chars": max(200, base - 400), "script_constraints": DIALOGUE_SPEAKER_RETRY_CONSTRAINTS},
        ]
    errors: list[str] = []
    attempt_errors: list[dict[str, Any]] = []
    trace_id: str | None = None
    last_upstream_status_code: int | None = None
    max_continue = _podcast_cfg_int("script_generation_max_continue_rounds", 12)
    shortfall_ratio = _podcast_cfg_float("script_generation_shortfall_ratio", 0.82)
    min_round_gain = _podcast_cfg_int("script_continue_min_round_gain_chars", 80)
    tail_max = _podcast_cfg_int("script_continue_material_tail_max_chars", 64_000)
    ref_tail_max = _podcast_cfg_int("script_continue_reference_tail_max_chars", 24_000)
    seg_cap = _podcast_cfg_int("script_generation_segment_target_chars_max", 4200)
    seg_cap = max(800, min(12_000, seg_cap))

    for idx, cfg in enumerate(attempts, start=1):
        try:
            goal = int(cfg["target_chars"])
            accumulated = ""
            article_outline_text = ""
            outline_min = article_outline_min_chars_threshold(selected_note_count)
            if (
                output_mode == "article"
                and _article_outline_first_enabled()
                and goal >= outline_min
            ):
                oc = str(cfg.get("script_constraints") or "").strip()
                if not oc and core_q:
                    oc = f"【核心问题】{core_q}"
                try:
                    out_res = minimax_client.generate_script_outline(
                        content=(text or "")[:80000],
                        total_target_chars=goal,
                        api_key=api_key,
                        script_style=script_style,
                        script_language=script_language,
                        program_name=program_name,
                        speaker1_persona=speaker1,
                        speaker2_persona=speaker2,
                        script_constraints=oc,
                        output_mode="article",
                    )
                    if out_res.get("success") and str(out_res.get("outline_text") or "").strip():
                        article_outline_text = str(out_res.get("outline_text") or "").strip()[:12000]
                except Exception as exc:
                    logger.warning("article outline pre-pass skipped: %s", exc)

            material = (
                f"{text}\n\n【写作提纲·正文须按此脉络展开】\n{article_outline_text}\n"
                if article_outline_text
                else text
            )
            continuity_round = 0
            last_fr: str | None = None
            continuation_shrink_pass = 0

            while continuity_round < max_continue:
                remaining = goal - len(accumulated)
                if remaining <= min_round_gain:
                    break

                ref_budget = ref_tail_max
                if continuation_shrink_pass == 1:
                    ref_budget = max(4000, min(12_000, ref_tail_max // 2))
                elif continuation_shrink_pass >= 2:
                    ref_budget = max(2000, min(6000, ref_tail_max // 4))

                if accumulated:
                    prog = (
                        _article_continuation_progress_summary(accumulated)
                        if output_mode == "article"
                        else ""
                    )
                    material = merge_script_continuation_material(
                        text,
                        accumulated,
                        tail_max=tail_max,
                        reference_tail_max=ref_budget,
                        output_mode=output_mode,
                        article_outline_block=article_outline_text if output_mode == "article" else "",
                        article_progress_summary=prog,
                    )

                seg_target = min(remaining, seg_cap)
                if not accumulated:
                    segment_role = "first" if goal > seg_cap else None
                else:
                    segment_role = "last" if remaining <= seg_cap else "middle"
                # 文章模式勿把「续写第N段」等写入 segment_position，易被模型抄进正文；双人播客仍保留便于分段提示
                if output_mode == "article":
                    segment_position = None
                elif not accumulated:
                    segment_position = (
                        f"第 1 段 · 全文目标约 {goal} 字" if goal > seg_cap else None
                    )
                else:
                    segment_position = f"续写第 {continuity_round + 1} 段 · 全文目标约 {goal} 字"

                if continuity_round == 0:
                    dialogue_or_article_c = cfg["script_constraints"]
                else:
                    dialogue_or_article_c = (
                        DIALOGUE_SPEAKER_RETRY_CONSTRAINTS if output_mode == "dialogue" else ""
                    )

                piece, fr, ev_trace = _consume_minimax_script_stream(
                    minimax_client.generate_script_stream(
                        material,
                        target_chars=seg_target,
                        api_key=api_key,
                        script_style=script_style,
                        script_language=script_language,
                        program_name=program_name,
                        speaker1_persona=speaker1,
                        speaker2_persona=speaker2,
                        script_constraints=dialogue_or_article_c,
                        output_mode=output_mode,
                        oral_for_tts=oral_for_tts,
                        segment_role=segment_role,
                        segment_position=segment_position,
                        full_goal_chars=goal if goal > seg_target else None,
                        core_question=core_q or None,
                    ),
                    on_script_delta=on_script_delta,
                    accumulated_prefix=accumulated,
                )
                if ev_trace:
                    trace_id = ev_trace
                last_fr = fr

                plen = len(piece.strip())
                if plen < min_round_gain:
                    if not accumulated.strip():
                        empty_msg = "上游返回空内容（0 chunk）"
                        errors.append(empty_msg)
                        attempt_errors.append({"attempt": idx, "message": empty_msg, "trace_id": trace_id})
                        break
                    still_need = goal - len(accumulated)
                    if still_need > max(400, goal // 10) and continuation_shrink_pass < 2:
                        continuation_shrink_pass += 1
                        logger.warning(
                            "脚本续写过短（%s 字）且距目标还差约 %s 字，将收缩参考材料末尾后重试（第 %s 次）",
                            plen,
                            still_need,
                            continuation_shrink_pass,
                        )
                        continue
                    break

                continuation_shrink_pass = 0

                if not accumulated:
                    accumulated = piece
                else:
                    accumulated = _join_script_continued(accumulated, piece, output_mode)

                continuity_round += 1
                if len(accumulated) >= goal:
                    break
                # 避免 len 恰好等于 goal*ratio（如 3600==4000×0.9）时误停：应用「>」而非「>=」式语义
                if fr == "length":
                    continue
                if len(accumulated) > goal * shortfall_ratio:
                    break
                continue

            script = accumulated.strip()
            if script:
                return {
                    "script": script,
                    "fallback": False,
                    "retries": idx - 1,
                    "trace_id": trace_id,
                    "upstream_status_code": last_upstream_status_code,
                    "attempt_errors": attempt_errors,
                    "error_message": "",
                    "script_continue_rounds": continuity_round,
                    "script_finish_reason": last_fr,
                }
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

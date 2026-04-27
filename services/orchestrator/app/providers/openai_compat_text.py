from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable, Iterator, Literal
from urllib import request

import requests

from ..entitlement_matrix import long_form_script_chars_cap, normalize_script_target_input
from ..fyv_shared.config import PODCAST_CONFIG, TIMEOUTS
from ..legacy_bridge import (
    DEFAULT_SCRIPT_CONSTRAINTS_DIALOGUE,
    DIALOGUE_SPEAKER_RETRY_CONSTRAINTS,
    _article_continuation_progress_summary,
    _article_outline_first_enabled,
    merge_script_continuation_material,
)
from ..script_reference_coverage import article_outline_min_chars_threshold

logger = logging.getLogger(__name__)


def _http_post_json(url: str, headers: dict[str, str], payload: dict[str, Any], timeout_sec: int = 60) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(url=url, data=data, headers=headers, method="POST")
    with request.urlopen(req, timeout=timeout_sec) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    return json.loads(body)


def _normalize_chat_message_content(val: Any) -> str:
    """
    OpenAI 兼容 Chat API 的 message.content / 流式 delta.content：
    常见为 str；部分厂商返回 list[dict]（如 type=text 片段）或单 dict（含 text 字段）。
    """
    if val is None:
        return ""
    if isinstance(val, str):
        return val
    if isinstance(val, list):
        parts: list[str] = []
        for item in val:
            if isinstance(item, dict):
                typ = str(item.get("type") or "").lower()
                if typ in ("reasoning", "thought"):
                    continue
                t = item.get("text")
                if isinstance(t, str) and t:
                    parts.append(t)
                    continue
                ot = item.get("output_text")
                if isinstance(ot, str) and ot:
                    parts.append(ot)
            elif isinstance(item, str) and item:
                parts.append(item)
        return "".join(parts)
    if isinstance(val, dict):
        t = val.get("text")
        if isinstance(t, str) and t:
            return t
        for k in ("content", "value"):
            inner = val.get(k)
            if isinstance(inner, str) and inner:
                return inner
    return str(val) if val else ""


def _content_from_response(resp: dict[str, Any]) -> str:
    choices = resp.get("choices") or []
    if not isinstance(choices, list) or not choices:
        return ""
    msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
    if isinstance(msg, dict):
        return _normalize_chat_message_content(msg.get("content")).strip()
    return ""


def _finish_reason_from_response(resp: dict[str, Any]) -> str:
    choices = resp.get("choices") or []
    if not isinstance(choices, list) or not choices:
        return ""
    c0 = choices[0]
    if not isinstance(c0, dict):
        return ""
    return str(c0.get("finish_reason") or "")


def _cfg_int(key: str, default: int) -> int:
    try:
        return int(PODCAST_CONFIG.get(key, default))
    except (TypeError, ValueError):
        return default


def _cfg_float(key: str, default: float) -> float:
    try:
        return float(PODCAST_CONFIG.get(key, default))
    except (TypeError, ValueError):
        return default


def _max_tokens_for_target_chars(target_chars: int, cap: int) -> int:
    """中文长稿：粗略按字数估 completion tokens，夹到厂商允许上限。"""
    try:
        est = int(target_chars * 1.2) + 320
    except (TypeError, ValueError):
        est = 2048
    return max(256, min(cap, est))


def _join_script_continued_local(accumulated: str, piece: str, output_mode: str) -> str:
    a = accumulated.rstrip()
    p = piece.lstrip()
    if not p:
        return accumulated
    sep = "\n" if output_mode == "dialogue" else "\n\n"
    return a + sep + p


def generate_script_openai_compatible(
    *,
    text: str,
    api_base: str,
    api_key: str,
    model: str,
    script_options: dict[str, Any] | None,
    on_script_delta: Callable[[str, str], None] | None,
    subscription_tier: str | None = None,
) -> dict[str, Any]:
    opts = script_options or {}
    style = str(opts.get("script_style") or "轻松幽默，自然流畅").strip()
    language = str(opts.get("script_language") or "中文").strip()
    program_name = str(opts.get("program_name") or "AI 播客节目").strip()
    output_mode = str(opts.get("output_mode") or "dialogue").strip().lower()
    if output_mode not in ("dialogue", "article"):
        output_mode = "dialogue"
    cap = long_form_script_chars_cap(subscription_tier)
    raw_tc = opts.get("script_target_chars")
    norm = normalize_script_target_input(raw_tc)
    if norm is not None:
        goal = max(200, min(cap, norm))
    else:
        # 与 legacy_bridge 未显式传目标时一致：默认篇幅 × preferred 上限，避免误用 1000 导致长文任务只出千字级
        try:
            _dft = int(PODCAST_CONFIG.get("script_target_chars_default", 800))
        except (TypeError, ValueError):
            _dft = 800
        try:
            _pref = int(PODCAST_CONFIG.get("script_target_chars_preferred_max", 2400))
        except (TypeError, ValueError):
            _pref = 2400
        implicit = min(_dft, _pref, cap)
        goal = max(200, int(implicit))
    user_constraints = str(opts.get("script_constraints") or "").strip()
    # 与 build_script_with_minimax 一致：双人且未传约束时用默认「纯对话、无舞台说明」
    if output_mode == "dialogue":
        first_script_constraints = user_constraints or DEFAULT_SCRIPT_CONSTRAINTS_DIALOGUE
    else:
        first_script_constraints = user_constraints
    oral_for_tts = bool(opts.get("oral_for_tts", True))
    oral_extra = ""
    if oral_for_tts:
        if output_mode == "article":
            oral_extra = (
                "\n- 语音向：文稿将用于 TTS 单人口播，以连贯口语段落为主，少用复杂 Markdown 与长编号列表。\n"
            )
        else:
            oral_extra = (
                "\n- 语音向：输出将直接用于 TTS，口语断句自然，无 Markdown，"
                "Speaker 行格式规范，可选用 <#0.5#> 停顿与白名单半角音效标签。\n"
            )

    mode_hint = "双人对话，每行以 Speaker1: / Speaker2: 开头" if output_mode != "article" else "输出完整文章"
    tok_cap = _cfg_int("openai_compat_script_max_tokens_cap", 8192)
    max_rounds = _cfg_int("script_generation_max_continue_rounds", 12)
    shortfall_ratio = _cfg_float("script_generation_shortfall_ratio", 0.82)
    min_gain = _cfg_int("script_continue_min_round_gain_chars", 80)
    tail_max = _cfg_int("script_continue_material_tail_max_chars", 64_000)
    ref_tail_max = _cfg_int("script_continue_reference_tail_max_chars", 24_000)
    seg_cap = _cfg_int("openai_compat_script_segment_target_chars_max", 4500)
    seg_cap = max(800, min(24_000, seg_cap))
    timeout_sec = int(TIMEOUTS.get("script_generation_openai_compat", 240))

    base = api_base.rstrip("/")
    url = f"{base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    def _constraints_for_round(material: str) -> str:
        """续写轮与 MiniMax 对齐：双人仅保留 Speaker 行约束；文章续写不再叠约束。"""
        if "【已生成上文】" not in material:
            return first_script_constraints
        if output_mode == "dialogue":
            return DIALOGUE_SPEAKER_RETRY_CONSTRAINTS
        return ""

    def _user_prompt(material: str, segment_target: int) -> str:
        cont = ""
        if "【已生成上文】" in material:
            cont = (
                "\n- 材料中若含【已生成上文】：请只输出紧接其后的新增正文，不要复述、不要从头重写；"
                "段首须直接承接上文最后一两句的话题与指代。\n"
            )
        total_line = ""
        if goal > seg_cap:
            if output_mode == "article":
                total_line = (
                    f"- 全文总目标约 {goal} 字；本段约 {segment_target} 字（同一篇文章的后续段落，勿写「续写」「第几段」等标记）。\n"
                )
            else:
                total_line = f"- 全文总目标约 {goal} 字；本段先完成约 {segment_target} 字（多轮续写拼接）。\n"
        article_zh = ""
        if output_mode == "article":
            ll = language.lower()
            if "中文" in language or ll in ("zh", "zh-cn", "简体", "简体中文"):
                article_zh = (
                    "- 中文须通篇使用大陆规范简体中文，勿使用繁体字或与繁体混排。\n"
                    "- 正文禁止出现「续写」「第几段」「（接续）」等编排说明；勿复述提示用语。\n"
                    "- 若材料含多个来源：须围绕统一主线或中心论点组织，将各来源对照、归纳或递进，避免「一书一节」互不衔接的堆砌。\n"
                    "- 禁止播客式结语（如「感谢收听」「感谢你的收听」「我们下次再见」）；中途分段禁止告别套话。\n"
                )
        round_c = _constraints_for_round(material).strip()
        core_line = ""
        if output_mode == "article":
            cq = str(opts.get("core_question") or "").strip()
            if cq:
                core_line = f"- 核心问题（须全文围绕）：{cq}\n"
        return (
            f"请基于材料生成{program_name}脚本。\n"
            f"- 语言：{language}\n"
            f"{core_line}"
            f"- 风格：{style}\n"
            f"- 输出形式：{mode_hint}\n"
            f"{article_zh}"
            f"{total_line}"
            f"- 本段目标字数：约{segment_target}字（未达全文目标可再补段，勿重复已写内容）\n"
            f"- 额外约束：{round_c or '无'}{oral_extra}{cont}\n\n"
            f"材料如下：\n{material}"
        )

    core_q = str(opts.get("core_question") or "").strip()
    article_outline_text = ""
    try:
        snc = int(opts.get("selected_note_count") or 0)
    except (TypeError, ValueError):
        snc = 0
    outline_min = article_outline_min_chars_threshold(snc)
    if (
        output_mode == "article"
        and _article_outline_first_enabled()
        and goal >= outline_min
    ):
        from app.fyv_shared.minimax_client import minimax_client

        oc = first_script_constraints.strip()
        if not oc and core_q:
            oc = f"【核心问题】{core_q}"
        try:
            out_res = minimax_client.generate_script_outline(
                content=(text or "")[:80000],
                total_target_chars=goal,
                api_key=None,
                script_style=style,
                script_language=language,
                program_name=program_name,
                speaker1_persona=str(opts.get("speaker1_persona") or "活泼亲切，引导话题").strip(),
                speaker2_persona=str(opts.get("speaker2_persona") or "稳重专业，深度分析").strip(),
                script_constraints=oc,
                output_mode="article",
            )
            if out_res.get("success") and str(out_res.get("outline_text") or "").strip():
                article_outline_text = str(out_res.get("outline_text") or "").strip()[:12000]
        except Exception as exc:
            logger.warning("openai_compat article outline skipped: %s", exc)

    full_script = ""
    material = (
        f"{text}\n\n【写作提纲·正文须按此脉络展开】\n{article_outline_text}\n"
        if article_outline_text
        else text
    )
    trace_id = ""
    last_finish = ""
    api_calls = 0
    http_round = 0
    continuation_shrink_pass = 0

    while http_round < max_rounds:
        remaining = goal - len(full_script)
        if remaining <= min_gain:
            break

        http_round += 1
        ref_budget = ref_tail_max
        if continuation_shrink_pass == 1:
            ref_budget = max(4000, min(12_000, ref_tail_max // 2))
        elif continuation_shrink_pass >= 2:
            ref_budget = max(2000, min(6000, ref_tail_max // 4))
        if full_script.strip():
            prog = (
                _article_continuation_progress_summary(full_script)
                if output_mode == "article"
                else ""
            )
            material = merge_script_continuation_material(
                text,
                full_script,
                tail_max=tail_max,
                reference_tail_max=ref_budget,
                output_mode=output_mode,
                article_outline_block=article_outline_text if output_mode == "article" else "",
                article_progress_summary=prog,
            )

        segment_target = min(remaining, seg_cap)
        prompt = _user_prompt(material, segment_target)
        max_tokens = _max_tokens_for_target_chars(segment_target, tok_cap)
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": "你是播客脚本助手。"},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.7,
            "max_tokens": max_tokens,
        }
        resp = _http_post_json(url, headers, payload, timeout_sec=timeout_sec)
        trace_id = str(resp.get("id") or trace_id)
        piece = _content_from_response(resp)
        fr = _finish_reason_from_response(resp)
        if fr:
            last_finish = fr
        if not piece.strip():
            if not full_script.strip():
                raise RuntimeError("openai_compatible_empty_content")
            still_need = goal - len(full_script)
            if still_need > max(400, goal // 10) and continuation_shrink_pass < 2:
                continuation_shrink_pass += 1
                continue
            break

        plen = len(piece.strip())
        if plen < min_gain and full_script.strip():
            still_need = goal - len(full_script)
            if still_need > max(400, goal // 10) and continuation_shrink_pass < 2:
                continuation_shrink_pass += 1
                continue
            break

        continuation_shrink_pass = 0
        api_calls += 1

        if not full_script.strip():
            full_script = piece.strip()
        else:
            full_script = _join_script_continued_local(full_script, piece, output_mode)

        if on_script_delta:
            on_script_delta(full_script, piece)

        if len(full_script) >= goal:
            break
        if last_finish == "length":
            continue
        if len(full_script) > goal * shortfall_ratio:
            break
        continue

    if not full_script.strip():
        raise RuntimeError("openai_compatible_empty_content")

    return {
        "script": full_script,
        "fallback": False,
        "retries": 0,
        "trace_id": trace_id,
        "upstream_status_code": None,
        "attempt_errors": [],
        "error_message": "",
        "script_continue_rounds": api_calls,
        "script_finish_reason": last_finish or None,
    }


def chat_completion_openai_compatible(
    *,
    messages: list[dict[str, str]],
    api_base: str,
    api_key: str,
    model: str,
    temperature: float = 0.65,
    timeout_sec: int = 120,
) -> str:
    """OpenAI 兼容 Chat Completions，不做播客提示词包装（供运营文案等使用）。"""
    base = api_base.rstrip("/")
    url = f"{base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": float(temperature),
    }
    resp = _http_post_json(url, headers, payload, timeout_sec=timeout_sec)
    content = _content_from_response(resp)
    if not content:
        raise RuntimeError("openai_compatible_empty_content")
    return content


StreamSegmentRole = Literal["reasoning", "answer"]


def _openai_stream_delta_segments(delta: dict[str, Any]) -> list[tuple[StreamSegmentRole, str]]:
    """单条 choices[0].delta 内按顺序拆成 (reasoning|answer, 文本) 片段（推理与正文分列，避免混在同一字符串）。"""
    out: list[tuple[StreamSegmentRole, str]] = []
    rc = _normalize_chat_message_content(delta.get("reasoning_content"))
    if rc:
        out.append(("reasoning", rc))
    rr = _normalize_chat_message_content(delta.get("reasoning"))
    if rr:
        out.append(("reasoning", rr))
    c = _normalize_chat_message_content(delta.get("content"))
    if c:
        out.append(("answer", c))
    return out


def _openai_stream_delta_text(delta: dict[str, Any], *, content_only: bool = False) -> str:
    """聚合流式 delta 文本：正文、推理模型 reasoning_content、以及数组型 content 片段。

    ``content_only=True`` 时仅拼接 ``content``（知识库问答等场景：不向用户展示推理过程）。
    """
    parts: list[str] = []

    def append_piece(val: object) -> None:
        chunk = _normalize_chat_message_content(val)
        if chunk:
            parts.append(chunk)

    if not content_only:
        append_piece(delta.get("reasoning_content"))
        append_piece(delta.get("reasoning"))
    append_piece(delta.get("content"))
    return "".join(parts)


def iter_chat_completion_openai_compatible_stream(
    *,
    messages: list[dict[str, str]],
    api_base: str,
    api_key: str,
    model: str,
    temperature: float = 0.65,
    timeout_sec: int = 120,
    content_only: bool = False,
) -> Iterator[str]:
    """OpenAI 兼容 Chat Completions 流式输出，逐段产出 delta 文本。"""
    base = api_base.rstrip("/")
    url = f"{base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": float(temperature),
        "stream": True,
    }
    resp = requests.post(
        url,
        headers=headers,
        json=payload,
        stream=True,
        timeout=(10, int(timeout_sec)),
    )
    resp.raise_for_status()
    for line in resp.iter_lines(decode_unicode=True):
        if not line:
            continue
        line_s = str(line).strip()
        if not line_s.startswith("data:"):
            continue
        raw = line_s[5:].strip()
        if raw == "[DONE]":
            break
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        err = data.get("error")
        if isinstance(err, dict) and err.get("message"):
            raise RuntimeError(str(err.get("message") or "upstream_error"))
        choices = data.get("choices") or []
        if not isinstance(choices, list) or not choices:
            continue
        c0 = choices[0] if isinstance(choices[0], dict) else {}
        delta = c0.get("delta") or {}
        if not isinstance(delta, dict):
            continue
        piece = _openai_stream_delta_text(delta, content_only=content_only)
        if piece:
            yield piece


def iter_chat_completion_openai_compatible_stream_segments(
    *,
    messages: list[dict[str, str]],
    api_base: str,
    api_key: str,
    model: str,
    temperature: float = 0.65,
    timeout_sec: int = 120,
) -> Iterator[tuple[StreamSegmentRole, str]]:
    """OpenAI 兼容流式：逐段产出 (reasoning|answer, 文本)，供笔记问答等区分展示。"""
    base = api_base.rstrip("/")
    url = f"{base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": float(temperature),
        "stream": True,
    }
    resp = requests.post(
        url,
        headers=headers,
        json=payload,
        stream=True,
        timeout=(10, int(timeout_sec)),
    )
    resp.raise_for_status()
    for line in resp.iter_lines(decode_unicode=True):
        if not line:
            continue
        line_s = str(line).strip()
        if not line_s.startswith("data:"):
            continue
        raw = line_s[5:].strip()
        if raw == "[DONE]":
            break
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        err = data.get("error")
        if isinstance(err, dict) and err.get("message"):
            raise RuntimeError(str(err.get("message") or "upstream_error"))
        choices = data.get("choices") or []
        if not isinstance(choices, list) or not choices:
            continue
        c0 = choices[0] if isinstance(choices[0], dict) else {}
        delta = c0.get("delta") or {}
        if not isinstance(delta, dict):
            continue
        for role, seg in _openai_stream_delta_segments(delta):
            if seg:
                yield (role, seg)


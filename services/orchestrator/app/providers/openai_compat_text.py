from __future__ import annotations

import json
from typing import Any, Callable
from urllib import request

from ..entitlement_matrix import long_form_script_chars_cap


def _http_post_json(url: str, headers: dict[str, str], payload: dict[str, Any], timeout_sec: int = 60) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(url=url, data=data, headers=headers, method="POST")
    with request.urlopen(req, timeout=timeout_sec) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    return json.loads(body)


def _content_from_response(resp: dict[str, Any]) -> str:
    choices = resp.get("choices") or []
    if not isinstance(choices, list) or not choices:
        return ""
    msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
    if isinstance(msg, dict):
        return str(msg.get("content") or "").strip()
    return ""


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
    cap = long_form_script_chars_cap(subscription_tier)
    raw_tc = opts.get("script_target_chars")
    if raw_tc is not None:
        try:
            target_chars = max(200, min(cap, int(raw_tc)))
        except (TypeError, ValueError):
            target_chars = max(200, min(cap, 1000))
    else:
        target_chars = max(200, min(cap, 1000))
    constraints = str(opts.get("script_constraints") or "").strip()
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
    prompt = (
        f"请基于材料生成{program_name}脚本。\n"
        f"- 语言：{language}\n"
        f"- 风格：{style}\n"
        f"- 输出形式：{mode_hint}\n"
        f"- 目标字数：约{target_chars}字\n"
        f"- 额外约束：{constraints or '无'}{oral_extra}\n\n"
        f"材料如下：\n{text}"
    )
    base = api_base.rstrip("/")
    url = f"{base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是播客脚本助手。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.7,
    }
    resp = _http_post_json(url, headers, payload)
    content = _content_from_response(resp)
    if not content:
        raise RuntimeError("openai_compatible_empty_content")
    if on_script_delta:
        on_script_delta(content, content)
    return {
        "script": content,
        "fallback": False,
        "retries": 0,
        "trace_id": str(resp.get("id") or ""),
        "upstream_status_code": None,
        "attempt_errors": [],
        "error_message": "",
    }


"""自媒体 LLM 辅助：JSON 解析、标签规范化、DeepSeek 调用（无 social_xhs / viral 依赖）。"""
from __future__ import annotations

import json
import re
from typing import Any

from .provider_router import invoke_llm_chat_messages_deepseek_only


def strip_code_fence(text: str) -> str:
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s*```\s*$", "", t)
    return t.strip()


def parse_json_object(raw: str) -> dict[str, Any]:
    t = strip_code_fence(raw)
    i = t.find("{")
    j = t.rfind("}")
    if i < 0 or j <= i:
        raise ValueError("no_json_object")
    return json.loads(t[i : j + 1])


def _clean_tag_token(raw: str) -> str:
    t = str(raw or "").strip().strip("'\"`#，,、 ")
    if not t or t in ("'", '"', "，", ",") or len(t) < 2:
        return ""
    if t.startswith("[") and t.endswith("]"):
        return ""
    return t[:40]


def normalize_tags(tags: Any) -> list[str]:
    if isinstance(tags, list):
        out = [_clean_tag_token(x) for x in tags]
        return [t for t in out if t][:12]
    if isinstance(tags, str) and tags.strip():
        s = tags.strip()
        quoted = re.findall(r"['\"]([^'\"]{2,40})['\"]", s)
        if quoted:
            out = [_clean_tag_token(x) for x in quoted]
            return [t for t in out if t][:12]
        if s.startswith("[") and s.endswith("]"):
            try:
                parsed = json.loads(s.replace("'", '"'))
                if isinstance(parsed, list):
                    out = [_clean_tag_token(x) for x in parsed]
                    return [t for t in out if t][:12]
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
        parts = re.split(r"[,，\s#]+", s)
        out = [_clean_tag_token(p) for p in parts]
        return [t for t in out if t][:12]
    return []


def format_hashtag_line(tags: list[str]) -> str:
    """小红书/公众号正文末尾话题行。"""
    parts: list[str] = []
    for t in tags:
        tok = _clean_tag_token(t)
        if not tok:
            continue
        parts.append(tok if tok.startswith("#") else f"#{tok}")
    return " ".join(parts)


def invoke_social_llm(
    system: str,
    user: str,
    *,
    max_tokens: int | None = None,
) -> tuple[str, None]:
    """自媒体文案：固定 DeepSeek（DEEPSEEK_API_KEY），不回退 MiniMax。"""
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    tok = int(max_tokens) if max_tokens is not None else 4096
    tok = max(1024, min(8192, tok))
    return invoke_llm_chat_messages_deepseek_only(
        messages,
        temperature=0.65,
        timeout_sec=120,
        max_tokens=tok,
    )


def invoke_and_parse_social_json(
    system: str,
    user: str,
    *,
    max_tokens: int | None = None,
) -> tuple[dict[str, Any], None]:
    """调用模型并解析 JSON；失败时追加约束重试一次。"""
    raw_out, trace_id = invoke_social_llm(system, user, max_tokens=max_tokens)
    try:
        return parse_json_object(raw_out), trace_id
    except (json.JSONDecodeError, ValueError):
        repair_user = (
            f"{user}\n\n"
            "【格式】只输出一个合法 JSON 对象，不要用 markdown 代码块，不要附加解释。"
        )
        raw2, trace_id2 = invoke_social_llm(system, repair_user, max_tokens=max_tokens)
        return parse_json_object(raw2), trace_id2

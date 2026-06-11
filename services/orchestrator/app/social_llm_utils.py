"""自媒体 LLM 辅助：JSON 解析、标签规范化、DeepSeek 调用（无 social_xhs / viral 依赖）。"""
from __future__ import annotations

import ast
import json
import logging
import os
import re
from collections.abc import Callable, Iterator
from typing import Any

from .provider_router import invoke_llm_chat_messages_deepseek_only
from .providers.openai_compat_text import iter_chat_completion_openai_compatible_stream

logger = logging.getLogger(__name__)


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
    timeout_sec: int = 75,
    temperature: float = 0.65,
) -> tuple[str, None]:
    """自媒体文案：固定 DeepSeek（DEEPSEEK_API_KEY），不回退 MiniMax。"""
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    tok = int(max_tokens) if max_tokens is not None else 4096
    tok = max(1024, min(8192, tok))
    wait = max(30, min(120, int(timeout_sec)))
    return invoke_llm_chat_messages_deepseek_only(
        messages,
        temperature=float(temperature),
        timeout_sec=wait,
        max_tokens=tok,
    )


def invoke_social_llm_stream_iter(
    system: str,
    user: str,
    *,
    max_tokens: int | None = None,
    timeout_sec: int = 75,
) -> Iterator[str]:
    """自媒体文案流式输出，供任务进行中增量写入 result / script_chunk。"""
    key = str(os.getenv("DEEPSEEK_API_KEY") or "").strip()
    base = str(os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com/v1").strip()
    model = str(os.getenv("DEEPSEEK_TEXT_MODEL") or "deepseek-v4-flash").strip()
    if not key:
        raise RuntimeError("deepseek_api_key_missing")
    if not base:
        raise RuntimeError("text_provider_deepseek_config_missing")
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    tok = int(max_tokens) if max_tokens is not None else 4096
    tok = max(1024, min(8192, tok))
    wait = max(30, min(120, int(timeout_sec)))
    yield from iter_chat_completion_openai_compatible_stream(
        messages=messages,
        api_base=base,
        api_key=key,
        model=model,
        temperature=0.65,
        timeout_sec=wait,
        content_only=True,
        max_tokens=tok,
    )


def _unescape_json_string_fragment(raw: str) -> str:
    frag = str(raw or "")
    if not frag:
        return ""
    try:
        return str(json.loads(f'"{frag}"'))
    except Exception:
        return (
            frag.replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace('\\"', '"')
            .replace("\\\\", "\\")
        )


def _extract_json_string_field(text: str, key: str) -> str:
    m = re.search(rf'"{re.escape(key)}"\s*:\s*"', text, re.DOTALL)
    if not m:
        return ""
    i = m.end()
    buf: list[str] = []
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            if i + 1 < len(text):
                buf.append(text[i : i + 2])
                i += 2
                continue
            break
        if ch == '"':
            break
        buf.append(ch)
        i += 1
    return _unescape_json_string_fragment("".join(buf)).strip()


def _extract_json_string_array(text: str, key: str, *, limit: int = 12) -> list[str]:
    m = re.search(rf'"{re.escape(key)}"\s*:\s*\[', text, re.DOTALL)
    if not m:
        return []
    rest = text[m.end() :]
    close = rest.find("]")
    next_key = re.search(r',\s*"[A-Za-z_][^"]*"\s*:', rest)
    if close >= 0:
        segment = rest[:close]
    elif next_key:
        segment = rest[: next_key.start()]
    else:
        segment = rest
    out: list[str] = []
    for hit in re.finditer(r'"((?:\\.|[^"\\])*)"', segment):
        val = _unescape_json_string_fragment(hit.group(1)).strip()
        if val:
            out.append(val)
        if len(out) >= limit:
            break
    return out


def _image_suggestion_from_dict(data: dict[str, Any]) -> str:
    pos = str(
        data.get("position") or data.get("type") or data.get("role") or data.get("slot") or ""
    ).strip()
    desc = str(
        data.get("description")
        or data.get("desc")
        or data.get("text")
        or data.get("content")
        or data.get("detail")
        or ""
    ).strip()
    title = str(data.get("title") or "").strip()
    if pos and desc:
        line = f"{pos}：{desc}"
    elif title and desc:
        line = f"{title}：{desc}"
    elif desc:
        line = desc
    elif pos:
        line = pos
    elif title:
        line = title
    else:
        parts = [str(v).strip() for v in data.values() if isinstance(v, str) and str(v).strip()]
        line = " · ".join(parts)
    return line[:300]


def format_image_suggestion_item(raw: Any) -> str:
    """将配图建议条目（字符串或 {position, description} 对象）格式化为可读一行。"""
    if isinstance(raw, dict):
        return _image_suggestion_from_dict(raw)
    s = str(raw or "").strip()
    if not s:
        return ""
    if s.startswith("{") and ("position" in s or "description" in s):
        for parser in (json.loads, ast.literal_eval):
            try:
                parsed = parser(s)
            except (json.JSONDecodeError, SyntaxError, TypeError, ValueError):
                continue
            if isinstance(parsed, dict):
                return _image_suggestion_from_dict(parsed)
    return s[:300]


def normalize_image_suggestion_lines(raw: Any, *, limit: int = 8) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        line = format_image_suggestion_item(item)
        if line and line not in out:
            out.append(line)
        if len(out) >= limit:
            break
    return out


def extract_partial_social_json_fields(acc: str) -> dict[str, Any]:
    """从流式 JSON 中尽力提取已生成字段（允许 JSON 未闭合）。"""
    text = strip_code_fence(acc)
    out: dict[str, Any] = {}
    for key in ("body", "theme", "cover_hook", "opening_30", "interaction"):
        val = _extract_json_string_field(text, key)
        if val:
            out[key] = val
    titles = _extract_json_string_array(text, "titles", limit=3)
    if titles:
        out["titles"] = titles
    bodies = _extract_json_string_array(text, "bodies", limit=3)
    if bodies:
        out["bodies"] = bodies
    tags = _extract_json_string_array(text, "tags", limit=12)
    if tags:
        out["tags"] = tags
    interactions = _extract_json_string_array(text, "interactions", limit=3)
    if interactions:
        out["interactions"] = interactions
    images = _extract_json_string_array(text, "imageSuggestions", limit=8)
    if images:
        out["imageSuggestions"] = images
    return out


def invoke_and_parse_social_json(
    system: str,
    user: str,
    *,
    max_tokens: int | None = None,
    on_stream_delta: Callable[[str], None] | None = None,
) -> tuple[dict[str, Any] | None, None]:
    """调用模型并解析 JSON；失败时追加约束重试一次；仍失败则返回 None。"""
    try:
        if on_stream_delta is None:
            raw_out, trace_id = invoke_social_llm(system, user, max_tokens=max_tokens)
        else:
            chunks: list[str] = []
            for piece in invoke_social_llm_stream_iter(system, user, max_tokens=max_tokens):
                chunks.append(piece)
                on_stream_delta("".join(chunks))
            raw_out = "".join(chunks).strip()
            trace_id = None
            if not raw_out:
                raise RuntimeError("empty_stream")
    except Exception as exc:
        logger.warning("invoke_social_llm failed: %s", exc)
        return None, None
    try:
        return parse_json_object(raw_out), trace_id
    except (json.JSONDecodeError, ValueError) as exc:
        # 不重试第二次 LLM（易叠加 RAG+合规导致网关 504）；由上层走资料摘录回退
        logger.warning("social json parse failed: %s", exc)
        return None, None

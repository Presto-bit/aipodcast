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


def normalize_tags(tags: Any) -> list[str]:
    if isinstance(tags, list):
        return [str(x).strip() for x in tags if str(x).strip()][:12]
    if isinstance(tags, str) and tags.strip():
        parts = re.split(r"[,，\s#]+", tags.strip())
        return [p for p in parts if p][:12]
    return []


def invoke_social_llm(system: str, user: str) -> tuple[str, None]:
    """自媒体文案：固定 DeepSeek（DEEPSEEK_API_KEY），不回退 MiniMax。"""
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    return invoke_llm_chat_messages_deepseek_only(
        messages,
        temperature=0.65,
        timeout_sec=120,
    )

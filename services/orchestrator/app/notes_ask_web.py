"""知识库「向资料提问」可选联网补充：Serper Google 搜索，结果注入上下文（与闭集资料叠加）。"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any

import requests

logger = logging.getLogger(__name__)

_SERPER_URL = "https://google.serper.dev/search"


def serper_api_key() -> str:
    return (os.getenv("NOTES_ASK_SERPER_API_KEY") or os.getenv("SERPER_API_KEY") or "").strip()


def skip_web_search_reason(question: str) -> str | None:
    q = (question or "").strip()
    if len(q) < 4:
        return "question_too_short"
    return None


def user_visible_message_for_skip(code: str) -> str:
    return _USER_MESSAGES.get(code, "本次未发起联网检索。")


def user_visible_message_for_failure(code: str) -> str:
    return _FAILURE_MESSAGES.get(code, "联网检索暂不可用，已仅根据您的资料作答。")


_USER_MESSAGES: dict[str, str] = {
    "question_too_short": "本次未发起联网检索：问题过短，可直接依据已选资料作答。",
    "web_search_unconfigured": "本次未发起联网检索：未配置检索服务（请设置 SERPER_API_KEY 或 NOTES_ASK_SERPER_API_KEY）。",
    "web_search_skipped_heuristic": "本次未发起联网检索：当前问题可直接依据已选资料回答。",
}

_FAILURE_MESSAGES: dict[str, str] = {
    "web_search_transport_error": "联网检索暂不可用，已仅根据您的资料作答。",
    "web_search_rate_limited": "联网检索暂不可用（限流），已仅根据您的资料作答。",
    "web_search_http_error": "联网检索暂不可用，已仅根据您的资料作答。",
    "web_search_bad_json": "联网检索暂不可用，已仅根据您的资料作答。",
    "web_search_no_results": "联网检索无结果，已仅根据您的资料作答。",
    "web_search_no_valid_links": "联网检索无有效链接，已仅根据您的资料作答。",
}


def fetch_web_supplement(
    question: str,
    *,
    request_id: str | None = None,
) -> tuple[str, list[dict[str, Any]], str | None]:
    """
    返回 (markdown 块, webSources 列表供 done 事件, 错误码)。
    markdown 为空表示不注入上下文；错误码用于日志与可选提示。
    """
    key = serper_api_key()
    rid = (request_id or "").strip()
    q = (question or "").strip()[:400]
    if not key:
        return "", [], "web_search_unconfigured"

    skip = skip_web_search_reason(q)
    if skip:
        return "", [], skip

    payload = {"q": q, "num": 5}
    try:
        r = requests.post(
            _SERPER_URL,
            headers={"X-API-KEY": key, "Content-Type": "application/json"},
            data=json.dumps(payload),
            timeout=8,
        )
    except requests.RequestException as exc:
        logger.warning("notes_ask_web transport rid=%s err=%s", rid, exc)
        return "", [], "web_search_transport_error"

    if r.status_code == 429:
        logger.warning("notes_ask_web rate_limited rid=%s", rid)
        return "", [], "web_search_rate_limited"
    if r.status_code >= 400:
        logger.warning("notes_ask_web http rid=%s status=%s", rid, r.status_code)
        return "", [], "web_search_http_error"

    try:
        data = r.json()
    except Exception:
        return "", [], "web_search_bad_json"

    organic = data.get("organic")
    if not isinstance(organic, list) or not organic:
        return "", [], "web_search_no_results"

    lines: list[str] = []
    sources: list[dict[str, Any]] = []
    n = 0
    for item in organic:
        if n >= 5:
            break
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip() or "(无标题)"
        link = str(item.get("link") or item.get("url") or "").strip()
        snippet = str(item.get("snippet") or "").strip()
        if not link or not (link.startswith("http://") or link.startswith("https://")):
            continue
        n += 1
        wid = f"w{n}"
        sources.append(
            {
                "index": wid,
                "title": title[:200],
                "url": link[:2000],
                "snippet": snippet[:600],
            }
        )
        lines.append(
            f"### 互联网来源 [{wid}] {title}\n"
            f"URL: {link}\n"
            f"摘要: {snippet or '（无摘要）'}\n"
        )

    if not lines:
        return "", [], "web_search_no_valid_links"

    block = "\n".join(lines).strip()
    qh = hashlib.sha256(q.encode("utf-8")).hexdigest()[:16]
    logger.info(
        "notes_ask_web rid=%s organic_used=%s query_sha16=%s",
        rid,
        len(sources),
        qh,
    )
    return block, sources, None



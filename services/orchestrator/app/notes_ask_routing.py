"""资料问答：片/章路由问句规范化、标题匹配与多轮钉住解除。"""
from __future__ import annotations

import re
from typing import Any

# 问句末尾常见「任务词」，去掉后便于命中书卷名（如 约翰福音介绍 → 约翰福音）
_ROUTE_TRIM_SUFFIX = re.compile(
    r"(?:介绍|概述|概要|摘要|内容|关系|异同|区别|特点|意义|背景|结构|大纲|梗概|主线|怎样|如何|什么)+$"
)

# 追问用语：命中时更倾向保留上一轮片/章（钉住）
_FOLLOW_UP_QUERY_RE = re.compile(
    r"(?:继续|接着|上文|上述|前面|刚才|刚刚|再[详细讲讲说说介绍概括总结]|[还有]什么补充|进一步|展开说说|详细一点|多说一点)",
    re.I,
)


def normalize_route_query(query: str) -> str:
    q = (query or "").strip()
    if not q:
        return ""
    for _ in range(6):
        m = _ROUTE_TRIM_SUFFIX.search(q)
        if not m:
            break
        cand = q[: m.start()].strip()
        if len(cand) < 2:
            break
        q = cand
    return q


def route_query_tokens(query: str) -> list[str]:
    q = normalize_route_query(query)
    if not q:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for t in re.findall(r"[\u4e00-\u9fff]{2,12}", q):
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out


def routing_title_hints(title: str) -> list[str]:
    """从片/章标题抽取可用于与问句匹配的书名/主题片段。"""
    t = (title or "").strip()
    if not t:
        return []
    hints: list[str] = [t]
    # 「马太福音 1」「约翰福音 第3章」
    m = re.match(r"^(.+?)\s*(?:第\s*[0-9０-９一二三四五六七八九十百千万零两]+|[0-9０-９]+)\s*章?", t)
    if m:
        core = (m.group(1) or "").strip()
        if core and core not in hints:
            hints.append(core)
    # 英文书名前缀
    m2 = re.match(r"^([A-Za-z][A-Za-z\s]{2,40})", t)
    if m2:
        hints.append(m2.group(1).strip())
    # 第一个「 / 」段（heading_path 风格）
    if " / " in t:
        head = t.split(" / ", 1)[0].strip()
        if head and head not in hints:
            hints.append(head)
    dedup: list[str] = []
    seen: set[str] = set()
    for h in hints:
        k = h.lower()
        if k and k not in seen:
            seen.add(k)
            dedup.append(h)
    return dedup


def query_mentions_hint(query: str, hint: str) -> bool:
    q = normalize_route_query(query).lower()
    h = (hint or "").strip().lower()
    if not q or not h or len(h) < 2:
        return False
    return h in q or q in h


def is_follow_up_query(query: str) -> bool:
    return bool(_FOLLOW_UP_QUERY_RE.search((query or "").strip()))


def _history_titles_blob(history: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for h in history:
        title = str(h.get("title") or "")
        parts.extend(routing_title_hints(title))
    return " ".join(parts).lower()


def should_keep_history_route_pin(
    query: str,
    history: list[dict[str, Any]],
    fresh_routed: list[dict[str, Any]],
    *,
    min_fresh_score: float = 0.18,
) -> bool:
    """
    True：沿用上一轮 activeShards/activeChapters（钉住）。
    False：采用本轮 fresh 路由结果（解除钉住）。
    """
    if not history:
        return True
    if not fresh_routed:
        return True
    if is_follow_up_query(query):
        return True

    q = normalize_route_query(query)
    if not q:
        return True

    hist_blob = _history_titles_blob(history)
    top = fresh_routed[0]
    fresh_title = str(top.get("title") or "")
    fresh_score = float(top.get("score") or 0)
    if fresh_score < min_fresh_score:
        return True

    # 问句明确指向 fresh 顶部片/章的书名，且与历史片/章标题不一致 → 换题，解除钉住
    for hint in routing_title_hints(fresh_title):
        if len(hint) < 2:
            continue
        if query_mentions_hint(q, hint):
            hl = hint.lower()
            if hl not in hist_blob and not any(query_mentions_hint(ht, hint) for ht in (str(h.get("title") or "") for h in history)):
                return False

    for token in route_query_tokens(q):
        if len(token) < 2:
            continue
        if token.lower() in hist_blob:
            continue
        if token.lower() in fresh_title.lower():
            return False
        for hint in routing_title_hints(fresh_title):
            if token in hint or hint in token:
                return False

    return True


def score_title_against_query(
    title: str,
    query: str,
    *,
    summary: str = "",
) -> float:
    """片/章标题与问句的匹配分（供 route 打分复用）。"""
    q = normalize_route_query(query).lower()
    if not q:
        return 0.0
    tl = (title or "").strip().lower()
    score = 0.0
    if tl and tl in q:
        score += 0.65
    for hint in routing_title_hints(title):
        hl = hint.lower()
        if len(hl) >= 2 and hl in q:
            score += 0.72
            break
    for token in route_query_tokens(query):
        if token in tl:
            score += 0.22
        elif tl and token in tl:
            score += 0.18
    sl = (summary or "").lower()
    if sl:
        hits = sum(1 for t in route_query_tokens(query) if t in sl)
        score += min(0.45, hits * 0.1)
    return score

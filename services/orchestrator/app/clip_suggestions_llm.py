"""剪辑页 DeepSeek / TEXT_PROVIDER：带词 id 的结构化建议 + 服务端校验。"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from typing import Any

from .provider_router import invoke_llm_chat_messages_with_minimax_fallback

logger = logging.getLogger(__name__)


def _words_from_normalized(norm: Any) -> list[dict[str, Any]]:
    if isinstance(norm, str):
        try:
            norm = json.loads(norm)
        except Exception:
            norm = {}
    if not isinstance(norm, dict):
        return []
    wl = norm.get("words") or []
    return [w for w in wl if isinstance(w, dict)]


def build_labeled_transcript_tsv(
    words: list[dict[str, Any]], *, max_words: int, char_budget: int
) -> tuple[str, frozenset[str]]:
    """
    每行：word_id \\t s_ms \\t e_ms \\t token（供模型引用 id，勿编造）。
    """
    valid: set[str] = set()
    lines: list[str] = []
    used = 0
    for w in words[:max_words]:
        wid = str(w.get("id") or "").strip()
        if not wid:
            continue
        try:
            s = int(w.get("s_ms") or 0)
            e = int(w.get("e_ms") or 0)
        except (TypeError, ValueError):
            s, e = 0, 0
        tok = f"{w.get('text') or ''}{w.get('punct') or ''}"
        tok = tok.replace("\n", " ").replace("\t", " ")[:48]
        line = f"{wid}\t{s}\t{e}\t{tok}"
        if used + len(line) + 1 > char_budget:
            break
        lines.append(line)
        used += len(line) + 1
        valid.add(wid)
    return "\n".join(lines), frozenset(valid)


def _is_consecutive_same_token(
    id_order: list[str],
    subset: list[str],
    id_to_tok: dict[str, str],
) -> bool:
    if len(subset) < 2:
        return False
    idx_map = {wid: i for i, wid in enumerate(id_order)}
    order_w = sorted([w for w in subset if w in idx_map], key=lambda w: idx_map[w])
    if len(order_w) != len(subset):
        return False
    positions = [idx_map[w] for w in order_w]
    for a, b in zip(positions, positions[1:]):
        if b != a + 1:
            return False
    toks = [id_to_tok.get(w, "") for w in order_w]
    return len(toks) >= 2 and len(set(toks)) == 1


def sanitize_llm_suggestion_items(
    items: list[dict[str, Any]],
    *,
    valid_ids: frozenset[str],
    words: list[dict[str, Any]],
    max_exclude: int = 24,
) -> list[dict[str, Any]]:
    """过滤非法 id；校验叠词连续；丢弃过长的删除列表。"""
    id_order = [
        str(w.get("id") or "").strip()
        for w in words
        if isinstance(w, dict) and str(w.get("id") or "").strip() in valid_ids
    ]
    id_to_tok: dict[str, str] = {}
    for w in words:
        if not isinstance(w, dict):
            continue
        wid = str(w.get("id") or "").strip()
        if wid in valid_ids:
            id_to_tok[wid] = f"{w.get('text') or ''}{w.get('punct') or ''}"

    out: list[dict[str, Any]] = []
    for it in items[:8]:
        if not isinstance(it, dict):
            continue
        title = str(it.get("title") or "").strip()[:80]
        body = str(it.get("body") or "").strip()[:800]
        if not title or not body:
            continue
        action = str(it.get("action") or "none").strip().lower()
        if action not in ("none", "exclude_word_ids", "keep_stutter_first"):
            action = "none"
        wid_raw = it.get("word_ids") if isinstance(it.get("word_ids"), list) else it.get("wordIds")
        raw_ids: list[str] = []
        if isinstance(wid_raw, list):
            for x in wid_raw:
                s = str(x).strip()
                if s in valid_ids:
                    raw_ids.append(s)
        raw_ids = list(dict.fromkeys(raw_ids))

        if action == "exclude_word_ids" and raw_ids:
            raw_ids = raw_ids[:max_exclude]
            out.append({"title": title, "body": body, "action": "exclude_word_ids", "word_ids": raw_ids})
            continue
        if action == "keep_stutter_first" and len(raw_ids) >= 2:
            if _is_consecutive_same_token(id_order, raw_ids, id_to_tok):
                out.append({"title": title, "body": body, "action": "keep_stutter_first", "word_ids": raw_ids})
                continue
        out.append({"title": title, "body": body, "action": "none", "word_ids": []})
    return out


def _parse_llm_json_array(raw: str) -> list[dict[str, Any]]:
    t = (raw or "").strip()
    if not t:
        return []
    start = t.find("[")
    end = t.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        arr = json.loads(t[start : end + 1])
    except json.JSONDecodeError:
        return []
    if not isinstance(arr, list):
        return []
    out: list[dict[str, Any]] = []
    for it in arr[:10]:
        if isinstance(it, dict):
            out.append(it)
    return out


def _plain_excerpt(words: list[dict[str, Any]], *, max_words: int, max_chars: int) -> str:
    parts: list[str] = []
    n = 0
    for w in words[:max_words]:
        parts.append(f"{w.get('text') or ''}{w.get('punct') or ''}")
        n += len(parts[-1])
        if n >= max_chars:
            break
    return "".join(parts)[:max_chars]


def _silence_hint_from_row(row: dict[str, Any]) -> str:
    sa = row.get("silence_analysis")
    if isinstance(sa, str):
        try:
            sa = json.loads(sa)
        except Exception:
            sa = None
    if not isinstance(sa, dict):
        return ""
    segs = sa.get("segments") or sa.get("items")
    if not isinstance(segs, list) or not segs:
        return ""
    bits: list[str] = []
    for s in segs[:6]:
        if isinstance(s, dict):
            try:
                a = int(s.get("start_ms") or 0)
                b = int(s.get("end_ms") or 0)
            except (TypeError, ValueError):
                continue
            if b > a:
                bits.append(f"{a / 1000:.1f}s–{b / 1000:.1f}s")
    if not bits:
        return ""
    return "（波形侧检测到长静音段，可结合删气口：" + "、".join(bits) + "）"


def _feedback_hint_from_row(row: dict[str, Any]) -> str:
    fb = row.get("suggestion_feedback")
    if isinstance(fb, str):
        try:
            fb = json.loads(fb)
        except Exception:
            fb = []
    if not isinstance(fb, list) or not fb:
        return ""
    tail = fb[-5:]
    try:
        return "近期用户操作摘要（请更保守对待曾被撤销的删改）：" + json.dumps(tail, ensure_ascii=False)[:900]
    except Exception:
        return ""


def _call_llm_outline(*, plain: str, silence_hint: str, feedback_hint: str) -> str:
    system = (
        "你是中文播客剪辑顾问。第一阶段：只输出「意向级」建议，不要给出 word_id。"
        "输出 JSON 数组，每项含 title（≤36字）、body（≤220字）。至多 5 条。"
        "关注：气口/静音、口头禅、重复论证、跑题、节奏拖沓；保守表述，勿编造细节。"
    )
    user = f"{silence_hint}\n{feedback_hint}\n\n转写节选：\n{plain}\n\n请输出 JSON 数组。"
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    raw, _tid = invoke_llm_chat_messages_with_minimax_fallback(messages, temperature=0.4, timeout_sec=90)
    return str(raw or "").strip()


def clip_llm_outline_from_row(row: dict[str, Any], words: list[dict[str, Any]], body: dict[str, Any]) -> list[dict[str, Any]]:
    plain = _plain_excerpt(words, max_words=700, max_chars=3800)
    if not plain.strip():
        return []
    sh = _silence_hint_from_row(row)
    fh = _feedback_hint_from_row(row)
    raw = _call_llm_outline(plain=plain, silence_hint=sh, feedback_hint=fh)
    items = _parse_llm_json_array(raw)
    if not items:
        m = re.search(r"\[[\s\S]*\]", raw)
        if m:
            items = _parse_llm_json_array(m.group(0))
    out: list[dict[str, Any]] = []
    for it in items[:6]:
        if not isinstance(it, dict):
            continue
        title = str(it.get("title") or "").strip()[:80]
        body_t = str(it.get("body") or "").strip()[:800]
        if not title or not body_t:
            continue
        sid = str(uuid.uuid4())
        out.append(
            {
                "suggestion_id": sid,
                "title": title,
                "body": body_t,
                "phase": 1,
                "action": "none",
                "word_ids": [],
            }
        )
    return out


def _parse_first_json_object(raw: str) -> dict[str, Any] | None:
    t = (raw or "").strip()
    if not t:
        return None
    s = t.find("{")
    e = t.rfind("}")
    if s < 0 or e <= s:
        arr = _parse_llm_json_array(t)
        if arr and isinstance(arr[0], dict):
            return arr[0]
        return None
    try:
        obj = json.loads(t[s : e + 1])
    except json.JSONDecodeError:
        return None
    return obj if isinstance(obj, dict) else None


def _call_llm_expand(
    *,
    labeled_tsv: str,
    seed_title: str,
    seed_body: str,
    feedback_hint: str,
) -> str:
    system = (
        "你是中文播客剪辑顾问。第二阶段：已有一条「意向建议」，请在词级 TSV 中找出可执行的具体词 id。"
        "只输出一个 JSON 对象（不要用数组包裹），字段：title、body、action、word_ids。"
        "title/body 可与意向略有调整但必须同一意图；action 为 none | exclude_word_ids | keep_stutter_first；"
        "word_ids 必须全部来自 TSV 首列；exclude 时不超过 20 个 id；keep_stutter_first 须相邻同 token。"
        "若无法安全落地则 action 用 none 且 word_ids 为 []。"
    )
    user = (
        f"{feedback_hint}\n\n意向标题：{seed_title}\n意向说明：{seed_body}\n\n词表 TSV（首列为 word_id）：\n"
        f"{labeled_tsv}\n\n请输出单个 JSON 对象。"
    )
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    raw, _tid = invoke_llm_chat_messages_with_minimax_fallback(messages, temperature=0.25, timeout_sec=120)
    return str(raw or "").strip()


def clip_llm_expand_from_row(row: dict[str, Any], words: list[dict[str, Any]], body: dict[str, Any]) -> list[dict[str, Any]]:
    title = str(body.get("title") or "").strip()
    body_t = str(body.get("body") or "").strip()
    parent_id = str(body.get("suggestion_id") or "").strip()
    if not title or not body_t:
        raise ValueError("expand 需要 title、body")
    try:
        max_words = int(body.get("max_words") or os.getenv("CLIP_LLM_SUGGESTION_MAX_WORDS") or "900")
    except (TypeError, ValueError):
        max_words = 900
    max_words = max(200, min(1600, max_words))
    try:
        char_budget = int(os.getenv("CLIP_LLM_SUGGESTION_CHAR_BUDGET") or "14000")
    except (TypeError, ValueError):
        char_budget = 14000
    char_budget = max(4000, min(24000, char_budget))
    labeled, valid_ids = build_labeled_transcript_tsv(words, max_words=max_words, char_budget=char_budget)
    if not labeled.strip():
        return []
    fh = _feedback_hint_from_row(row)
    raw = _call_llm_expand(labeled_tsv=labeled, seed_title=title, seed_body=body_t, feedback_hint=fh)
    obj = _parse_first_json_object(raw)
    if not obj:
        return []
    items = [obj]
    cleaned = sanitize_llm_suggestion_items(items, valid_ids=valid_ids, words=words)
    for it in cleaned:
        it["parent_suggestion_id"] = parent_id
        it["phase"] = 2
    return cleaned[:1]


def _call_llm_structured(*, labeled_tsv: str, valid_count: int) -> str:
    system = (
        "你是中文播客剪辑顾问。输入为制表符分隔的「词级转写」，每行：word_id、s_ms、e_ms、token。"
        "请基于这些内容给出至多 6 条剪辑建议。必须只输出 JSON 数组，勿使用 Markdown 或代码围栏。"
        "每项字段：title（≤40字）、body（说明理由与听感，≤200字）、action、word_ids。"
        "action 取值：none（仅建议）| exclude_word_ids（建议删掉这些词）| keep_stutter_first（连续重复口癖，只保留第一个词）。"
        "word_ids 必须全部来自输入首列已出现的 id，禁止编造；exclude_word_ids 时每条建议 word_ids 不超过 20 个且须同一段落内可删的赘语/口癖/明显重复；"
        "keep_stutter_first 时 word_ids 须为时间顺序相邻、token 完全相同的至少 2 个 id。"
        "不确定时 action 用 none，word_ids 用 []。保守优先，避免删掉承载信息的实词。"
    )
    user = (
        f"共 {valid_count} 个词块（下列为前段 TSV，id 即首列）：\n\n{labeled_tsv}\n\n"
        "输出示例：[{\"title\":\"…\",\"body\":\"…\",\"action\":\"none\",\"word_ids\":[]}]"
    )
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    raw, _tid = invoke_llm_chat_messages_with_minimax_fallback(messages, temperature=0.28, timeout_sec=120)
    return str(raw or "").strip()


def clip_edit_suggestions_from_row(row: dict[str, Any], body: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """
    mode=structured（默认）：带 id TSV 一次生成可执行建议。
    mode=outline：两阶段之一，仅意向。
    mode=expand：两阶段之二，单条意向扩展为带 word_ids 的建议。
    """
    b = body or {}
    words = _words_from_normalized(row.get("transcript_normalized"))
    if not words:
        return []
    mode = str(b.get("mode") or "structured").strip().lower()
    if mode == "outline":
        return clip_llm_outline_from_row(row, words, b)
    if mode == "expand":
        return clip_llm_expand_from_row(row, words, b)
    try:
        max_words = int(b.get("max_words") or os.getenv("CLIP_LLM_SUGGESTION_MAX_WORDS") or "900")
    except (TypeError, ValueError):
        max_words = 900
    max_words = max(200, min(1600, max_words))
    try:
        char_budget = int(os.getenv("CLIP_LLM_SUGGESTION_CHAR_BUDGET") or "14000")
    except (TypeError, ValueError):
        char_budget = 14000
    char_budget = max(4000, min(24000, char_budget))

    labeled, valid_ids = build_labeled_transcript_tsv(words, max_words=max_words, char_budget=char_budget)
    if not labeled.strip():
        return []

    raw = _call_llm_structured(labeled_tsv=labeled, valid_count=min(len(words), max_words))
    items = _parse_llm_json_array(raw)
    if not items:
        m = re.search(r"\[[\s\S]*\]", raw)
        if m:
            items = _parse_llm_json_array(m.group(0))
    out = sanitize_llm_suggestion_items(items, valid_ids=valid_ids, words=words)
    for it in out:
        it.setdefault("phase", 2)
    return out


def clip_llm_edit_suggestions(*, transcript_excerpt: str) -> list[dict[str, str]]:
    """兼容旧接口：纯文本片段（无 id 校验），仅 title/body。"""
    excerpt = (transcript_excerpt or "").strip()[:14_000]
    if not excerpt:
        return []
    system = (
        "你是中文播客剪辑顾问。根据口播转写文本给出至多 6 条剪辑建议。"
        "只输出 JSON 数组，不要 Markdown。每项含 title、body。保守、可操作。"
    )
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, {"role": "user", "content": excerpt}]
    raw, _tid = invoke_llm_chat_messages_with_minimax_fallback(messages, temperature=0.35, timeout_sec=90)
    items = _parse_llm_json_array(raw)
    out: list[dict[str, str]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        title = str(it.get("title") or "").strip()[:80]
        body = str(it.get("body") or "").strip()[:600]
        if title and body:
            out.append({"title": title, "body": body})
    if not out:
        m = re.search(r"\[[\s\S]*\]", raw)
        if m:
            for it in _parse_llm_json_array(m.group(0)):
                if isinstance(it, dict):
                    title = str(it.get("title") or "").strip()[:80]
                    body = str(it.get("body") or "").strip()[:600]
                    if title and body:
                        out.append({"title": title, "body": body})
    return out[:8]

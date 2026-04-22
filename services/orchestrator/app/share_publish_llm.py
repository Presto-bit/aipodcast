"""RSS / 分享发布：用 TEXT_PROVIDER（DeepSeek/Qwen + MiniMax 回退）生成简介与 Show Notes。"""

from __future__ import annotations

import difflib
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

from .models import list_job_artifacts
from .note_work_meta import human_note_source_label, snapshot_notes_source_titles
from .object_store import get_object_bytes
from .provider_router import invoke_llm_chat_messages_with_minimax_fallback

logger = logging.getLogger(__name__)

SCRIPT_LIKELY_FULL_MIN_LEN = 280
# RSS item.description / 列表摘要：与前端一致，极短
RSS_SUMMARY_MAX_CHARS = 50
SHOW_NOTES_MAX = 20_000

# Map-Reduce：控制分块与 LLM 调用次数
_MAP_CHUNK_SOFT_MAX = 2600
_MAP_MAX_CHUNKS = 8
_ASSEMBLE_USER_MAX = 8000


def _strip_code_fence(text: str) -> str:
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s*```\s*$", "", t)
    return t.strip()


def _parse_json_object(raw: str) -> dict[str, Any]:
    t = _strip_code_fence(raw)
    i = t.find("{")
    j = t.rfind("}")
    if i < 0 or j <= i:
        raise ValueError("no_json_object")
    return json.loads(t[i : j + 1])


def _result_dict(row: dict[str, Any]) -> dict[str, Any]:
    raw = row.get("result")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            out = json.loads(raw)
            return out if isinstance(out, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _payload_dict(row: dict[str, Any]) -> dict[str, Any]:
    raw = row.get("payload")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            out = json.loads(raw)
            return out if isinstance(out, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def resolve_script_body_for_share(job_id: str, row: dict[str, Any]) -> str:
    """与 Web 端一致：result.script_text 足够长则用之，否则拉 script 工件正文。"""
    result = _result_dict(row)
    from_result = str(result.get("script_text") or "").strip()
    if len(from_result) >= SCRIPT_LIKELY_FULL_MIN_LEN:
        return from_result
    jid = (job_id or "").strip()
    if jid:
        try:
            for art in list_job_artifacts(jid):
                if str(art.get("artifact_type") or "") != "script":
                    continue
                key = str(art.get("object_key") or "").strip()
                if not key:
                    break
                try:
                    data = get_object_bytes(key)
                    text = data.decode("utf-8", errors="replace").strip()
                    if text:
                        return text
                except Exception:
                    logger.warning("share_ai script artifact fetch failed job_id=%s", jid, exc_info=True)
                break
        except Exception:
            logger.warning("share_ai list_job_artifacts failed job_id=%s", jid, exc_info=True)
    return from_result or str(result.get("preview") or result.get("script_preview") or "").strip()


def condense_script_for_share_llm(raw: str, max_chars: int = 14_000) -> str:
    """去掉对白行首标记，压缩空白，截断以控制 token。"""
    lines_out: list[str] = []
    for line in (raw or "").splitlines():
        s = line.strip()
        if not s:
            continue
        s = re.sub(r"^\s*Speaker\s*\d+\s*[:：]\s*", "", s, flags=re.IGNORECASE)
        s = re.sub(r"^\s*说话人\s*[12]\s*[:：]\s*", "", s)
        s = re.sub(r"^\s*S\s*[12]\s*[:：]\s*", "", s, flags=re.IGNORECASE)
        if s:
            lines_out.append(s)
    text = "\n".join(lines_out)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > max_chars:
        text = text[:max_chars] + "…"
    return text


def build_share_user_source_text(
    payload: dict[str, Any],
    result: dict[str, Any] | None = None,
) -> str:
    """
    供大模型理解「这期在讲什么」的补充材料；笔记本播客常见 payload.text 为空（素材走 RAG/笔记合并）。
    与 merge_reference_for_script 的输入维度对齐；成功落库后的 result 里常有 notes_source_*，一并并入。
    """
    pl = payload if isinstance(payload, dict) else {}
    rs = result if isinstance(result, dict) else {}
    parts: list[str] = []
    base = str(pl.get("text") or "").strip()
    if base:
        parts.append(base)
    cq = str(pl.get("core_question") or "").strip()
    if cq and cq not in base:
        parts.append(f"【核心问题】\n{cq[:2000]}")
    pn = str(pl.get("program_name") or "").strip()
    if pn and len(pn) >= 2 and pn not in base:
        parts.append(f"【节目形态 / 体裁】\n{pn[:400]}")
    sc = str(pl.get("script_constraints") or "").strip()
    if sc and sc not in base and len(sc) >= 4:
        parts.append(f"【撰稿约束 / 风格说明】\n{sc[:1200]}")
    titles = [t for t in snapshot_notes_source_titles(pl) if t and t != "未命名笔记"]
    if titles:
        parts.append("【引用笔记】\n" + " · ".join(titles[:16]))
    if not titles:
        rt = rs.get("notes_source_titles")
        if isinstance(rt, list) and rt:
            line = " · ".join(
                human_note_source_label(x) for x in rt[:20] if str(x).strip() and human_note_source_label(x) != "未命名笔记"
            )
            if line:
                parts.append("【引用笔记（成片元数据）】\n" + line)
    nb = str(rs.get("notes_source_notebook") or pl.get("notes_notebook") or "").strip()
    if nb:
        parts.append(f"【笔记本】\n{nb[:200]}")
    ref_texts = pl.get("reference_texts")
    if isinstance(ref_texts, list):
        buf: list[str] = []
        for t in ref_texts[:8]:
            s = str(t).strip() if isinstance(t, str) else ""
            if s:
                buf.append(s[:2000])
        if buf:
            chunk = "\n---\n".join(buf)
            if len(chunk) > 3500:
                chunk = chunk[:3500] + "…"
            parts.append("【用户附加参考】\n" + chunk)
    return "\n\n".join(parts).strip()


def format_audio_chapters_hint(result: dict[str, Any]) -> str:
    raw = result.get("audio_chapters")
    if not isinstance(raw, list) or not raw:
        return ""
    lines: list[str] = []
    for o in raw:
        if not isinstance(o, dict):
            continue
        title = str(o.get("title") or "章节").replace("]", "］").replace("[", "［").strip() or "章节"
        start_ms = int(o.get("start_ms") or 0)
        sec = max(0, start_ms // 1000)
        mm = sec // 60
        ss = sec % 60
        clock = f"{mm}:{ss:02d}"
        lines.append(f"- [{clock} {title}](t:{sec})")
    return "\n".join(lines)


def _split_timeline_markdown_bullets(hint: str) -> list[str]:
    return [ln.strip() for ln in (hint or "").splitlines() if ln.strip().startswith("- ")]


def _pick_focus_chapter_indices(n: int, k: int) -> list[int]:
    """在 n 条时间线里均匀取 k 个索引（含首尾），用于导听「抓重点」。"""
    if n <= 0:
        return []
    if n <= k:
        return list(range(n))
    if k <= 2:
        return [0, n - 1][:k]
    out: list[int] = []
    seen: set[int] = set()
    for i in range(k):
        idx = int(round(i * (n - 1) / (k - 1)))
        idx = max(0, min(n - 1, idx))
        if idx not in seen:
            out.append(idx)
            seen.add(idx)
    return out


def _curate_chapter_timeline_for_llm(hint: str, *, max_items: int = 8) -> str:
    """
    切段很多时压缩进提示词：避免模型在 show_notes 里机械罗列十几条；
    仍保留「共 N 段」与锚点时间戳，要求模型写听法导语 + 少量跳转。
    """
    lines = _split_timeline_markdown_bullets(hint)
    if not lines:
        return (hint or "").strip()
    n = len(lines)
    if n <= max_items:
        return "\n".join(lines)
    idxs = _pick_focus_chapter_indices(n, max_items)
    picked = [lines[i] for i in idxs]
    note = (
        f"（本集音频共 {n} 个切段；撰写「## 节目导听」时须先用 1～2 句听法导语，再**只**使用下列 "
        f"{len(picked)} 条时间锚点，勿把全部段标题逐条列出；秒数必须与之一致。）\n"
    )
    return note + "\n".join(picked)


def _curate_chapter_lines_for_display(hint: str, *, max_items: int = 7) -> list[str]:
    lines = _split_timeline_markdown_bullets(hint)
    if not lines:
        return []
    if len(lines) <= max_items:
        return lines
    idxs = _pick_focus_chapter_indices(len(lines), max_items)
    return [lines[i] for i in idxs]


def _template_program_listen_block(chapter_hint: str, hook: str, facts: list[str]) -> str:
    """模板兜底里的「节目导听」：听法导语 + 精选时间锚。"""
    picked = _curate_chapter_lines_for_display(chapter_hint, max_items=7)
    if not picked:
        return ""
    lead = (hook or "").strip()
    if not lead and facts:
        lead = str(facts[0]).strip()
    if not lead:
        lead = "可按下方时间码跳转到信息最密集的部分。"
    if len(lead) > 160:
        lead = lead[:159] + "…"
    body = "\n".join(picked)
    return f"## 节目导听\n\n**建议先听：**{lead}\n\n{body}".strip()


def _build_share_user_message_blocks(
    *,
    condensed: str,
    material: str,
    episode_title_hint: str,
    chapter_timeline_hint: str,
) -> str:
    parts: list[str] = []
    if material:
        parts.append(f"【用户创作素材 / 选题背景（优先依据）】\n{material}")
    hint = (episode_title_hint or "").strip()
    if hint:
        parts.append(f"【单集标题参考（可呼应，勿原样当标题）】\n{hint[:300]}")
    if chapter_timeline_hint.strip():
        parts.append(f"【节目导听时间线（写 show_notes 时精选使用，勿流水账罗列）】\n{chapter_timeline_hint.strip()[:6000]}")
    parts.append(f"【口播正文供提炼（勿全文粘贴到 show_notes）】\n{condensed}")
    return "\n\n".join(parts)


def _chunk_condensed_for_map(text: str, soft_max: int = _MAP_CHUNK_SOFT_MAX) -> list[str]:
    """按空行分段再合并，避免固定字数切断句子；过长段再硬切。"""
    t = (text or "").strip()
    if not t:
        return []
    if len(t) <= soft_max:
        return [t]
    paras = re.split(r"\n\s*\n", t)
    paras = [p.strip() for p in paras if p and p.strip()]
    if not paras:
        return [t[:soft_max]]
    chunks: list[str] = []
    buf: list[str] = []
    cur = 0
    for p in paras:
        extra = len(p) + (2 if buf else 0)
        if cur + extra > soft_max and buf:
            chunks.append("\n\n".join(buf))
            buf = [p]
            cur = len(p)
        else:
            buf.append(p)
            cur += extra
    if buf:
        chunks.append("\n\n".join(buf))
    out: list[str] = []
    for c in chunks:
        if len(c) <= soft_max:
            out.append(c)
        else:
            start = 0
            while start < len(c):
                out.append(c[start : start + soft_max])
                start += soft_max
    return out


def _rechunk_cap_count(chunks: list[str], condensed_len: int, max_chunks: int = _MAP_MAX_CHUNKS) -> list[str]:
    if len(chunks) <= max_chunks:
        return chunks
    target = max(_MAP_CHUNK_SOFT_MAX, condensed_len // max_chunks + 400)
    target = min(target, 6000)
    return _chunk_condensed_for_map("\n\n".join(chunks), soft_max=target)


_SYSTEM_MAP_CHUNK = """你是中文播客编辑，正在通读本段口播做「信息抽取」。只输出一个 JSON 对象，不要 markdown 代码块，不要解释。首字符必须是 { ，末字符必须是 } 。
键名固定为：facts（字符串数组）、topics（字符串数组）、hook_line（字符串）。
facts：2～6 条（本段信息量极少时可 1 条，但不要全空）。每条一句完整中文，写清听众能带走的内容：论点、因果、例子、方法步骤、对比或具体判断；不强制每条都有专有名词或数字，但禁止空泛形容与「本期」「我们聊聊」类废话。
topics：1～4 条，每个 2～20 字，尽量具体。
hook_line：一句概括本段在整期里的作用或核心命题；若无把握可写空字符串 ""。
只根据下方「本段口播」与「共用背景」中出现的信息归纳，不要编造未出现的事实。"""


_SYSTEM_GLOBAL_OUTLINE = """你是中文播客主编，通读整期素材后整理「听众没听也能知道这期具体讲了什么」。只输出一个 JSON 对象，不要 markdown 代码块，不要解释。首字符必须是 { ，末字符必须是 } 。
键名固定为：facts（字符串数组）、topics（字符串数组）、episode_hook（字符串）。
facts：写满 6～10 条（素材很短时可 4～5 条）。每条一句话，优先包含：核心论点、论证链条、具体例子、可操作的方法或步骤、对比/反常识、给听众的判断标准或建议；不必每条都有数字或专有名词，但必须具体可复述，禁止「干货满满」「深度好文」等空话。
topics：4～8 条，每条 2～14 字，尽量用素材里出现的具体词；避免单独使用「成长」「商业」「认知」等过大而无落点的词，除非素材仅止于此。
episode_hook：用 28～90 字写清「这期最值得听的收获或问题意识」，不要用「欢迎收听」「本期我们」开头。
禁止编造素材与口播未出现的人名、机构、数据、书名；禁止套话。"""


def _build_map_chunk_user_message(
    *,
    material_head: str,
    episode_title_hint: str,
    chapter_head: str,
    chunk_index: int,
    chunk_total: int,
    chunk_text: str,
) -> str:
    parts: list[str] = []
    mh = (material_head or "").strip()
    if mh:
        parts.append(f"【共用背景 / 用户素材（优先依据）】\n{mh}")
    th = (episode_title_hint or "").strip()
    if th:
        parts.append(f"【单集标题参考】\n{th[:300]}")
    ch = (chapter_head or "").strip()
    if ch:
        parts.append(f"【节目导听时间线参考】\n{ch[:2500]}")
    parts.append(f"【分段位置】第 {chunk_index + 1}/{chunk_total} 段\n【本段口播】\n{chunk_text.strip()}")
    return "\n\n".join(parts).strip()[:13_000]


def _gather_facts_from_data(data: dict[str, Any], *, max_items: int) -> list[str]:
    """合并多键名的事实列表，全局与分块抽取共用。"""
    order_keys = ("facts", "key_points", "takeaways", "要点", "bullets", "points")
    out: list[str] = []
    seen: set[str] = set()
    for key in order_keys:
        arr = data.get(key)
        if not isinstance(arr, list):
            continue
        for x in arr:
            s = str(x).strip().replace("\r\n", " ")
            if len(s) < 5:
                continue
            k = s[:120].casefold()
            if k in seen:
                continue
            seen.add(k)
            out.append(s[:420])
            if len(out) >= max_items:
                return out
    return out


def _gather_topics_from_data(data: dict[str, Any], *, max_items: int) -> list[str]:
    topics_raw = data.get("topics") or data.get("主题") or data.get("labels") or []
    out: list[str] = []
    seen: set[str] = set()
    if isinstance(topics_raw, list):
        for x in topics_raw:
            s = str(x).strip()
            if not (2 <= len(s) <= 40):
                continue
            lk = s.casefold()
            if lk in seen:
                continue
            seen.add(lk)
            out.append(s)
            if len(out) >= max_items:
                break
    return out


def _parse_structured_extract_payload(raw: str, *, max_facts: int) -> dict[str, Any]:
    data = _parse_json_object(raw)
    facts = _gather_facts_from_data(data, max_items=max_facts)
    topics = _gather_topics_from_data(data, max_items=8)
    hook = str(
        data.get("hook_line") or data.get("episode_hook") or data.get("hook") or ""
    ).strip()
    return {"facts": facts, "topics": topics, "hook_line": hook[:280]}


def _parse_map_chunk_payload(raw: str) -> dict[str, Any]:
    return _parse_structured_extract_payload(raw, max_facts=8)


def _invoke_map_extract_json(user: str, api_key: str | None) -> tuple[dict[str, Any], str | None]:
    messages = [{"role": "system", "content": _SYSTEM_MAP_CHUNK}, {"role": "user", "content": user}]
    raw, trace_id = invoke_llm_chat_messages_with_minimax_fallback(
        messages, temperature=0.32, api_key=api_key, timeout_sec=75
    )
    try:
        return _parse_map_chunk_payload(raw), trace_id
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("share_rss map chunk json parse failed, retry once: %s", exc)
        fix_user = (
            '你上一次输出不是合法 JSON。请严格只输出 {"facts":["…"],"topics":["…"],"hook_line":"…"}，'
            "不要代码块，不要其它文字。\n\n" + user[:10_000]
        )
        raw2, tid2 = invoke_llm_chat_messages_with_minimax_fallback(
            [
                {"role": "system", "content": _SYSTEM_MAP_CHUNK},
                {"role": "user", "content": fix_user},
            ],
            temperature=0.26,
            api_key=api_key,
            timeout_sec=75,
        )
        return _parse_map_chunk_payload(raw2), tid2 or trace_id


def _invoke_global_outline_extract(user_base: str, api_key: str | None) -> tuple[dict[str, Any] | None, str | None]:
    """通读 user_base（素材+口播）一次，补全分块丢失的全局要点。"""
    u = (user_base or "").strip()[:14_000]
    if len(u) < 80:
        return None, None
    messages = [{"role": "system", "content": _SYSTEM_GLOBAL_OUTLINE}, {"role": "user", "content": u}]
    raw, trace_id = invoke_llm_chat_messages_with_minimax_fallback(
        messages, temperature=0.38, api_key=api_key, timeout_sec=100
    )
    try:
        return _parse_structured_extract_payload(raw, max_facts=12), trace_id
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("share_rss global outline json parse failed, retry once: %s", exc)
        fix_user = (
            "你上一次输出不是合法 JSON。请严格只输出 "
            '{"facts":["…"],"topics":["…"],"episode_hook":"…"}，不要代码块，不要其它文字。\n\n' + u[:12_000]
        )
        raw2, tid2 = invoke_llm_chat_messages_with_minimax_fallback(
            [
                {"role": "system", "content": _SYSTEM_GLOBAL_OUTLINE},
                {"role": "user", "content": fix_user},
            ],
            temperature=0.30,
            api_key=api_key,
            timeout_sec=100,
        )
        try:
            return _parse_structured_extract_payload(raw2, max_facts=12), tid2 or trace_id
        except (json.JSONDecodeError, ValueError):
            return None, tid2 or trace_id


def _merge_map_partials(rows: list[dict[str, Any]]) -> dict[str, Any]:
    facts: list[str] = []
    seen_f: set[str] = set()
    topics: list[str] = []
    seen_t: set[str] = set()
    hooks: list[str] = []
    for r in rows:
        for f in r.get("facts") or []:
            s = str(f).strip().replace("\r\n", " ")
            if len(s) < 5:
                continue
            key = s[:100].casefold()
            if key in seen_f:
                continue
            seen_f.add(key)
            facts.append(s[:400])
        for t in r.get("topics") or []:
            s = str(t).strip()
            if not (2 <= len(s) <= 40):
                continue
            lk = s.casefold()
            if lk in seen_t:
                continue
            seen_t.add(lk)
            topics.append(s)
        h = str(r.get("hook_line") or "").strip()
        if len(h) >= 8:
            hooks.append(h[:280])
    episode_hook = ""
    if hooks:
        episode_hook = max(hooks, key=len)
    return {"facts": facts[:18], "topics": topics[:8], "episode_hook": episode_hook}


def _format_assemble_user_message(
    merged: dict[str, Any],
    chapter_timeline_hint: str,
    episode_title_hint: str,
) -> str:
    payload = {
        "episode_hook": merged.get("episode_hook") or "",
        "facts": merged.get("facts") or [],
        "topics": merged.get("topics") or [],
    }
    body = json.dumps(payload, ensure_ascii=False)
    parts: list[str] = [f"【结构化要点 JSON】\n{body}"]
    th = (episode_title_hint or "").strip()
    if th:
        parts.append(f"【单集标题参考（可呼应）】\n{th[:200]}")
    ch = (chapter_timeline_hint or "").strip()
    if ch:
        parts.append(f"【节目导听时间线（须与 show_notes 中时间戳一致；精选呈现，勿逐条堆叠）】\n{ch[:5000]}")
    return "\n\n".join(parts).strip()[:_ASSEMBLE_USER_MAX]


_SYSTEM_ASSEMBLE_FROM_STRUCTURE = """你是中文播客编辑，根据编辑已合并的结构化要点撰写 RSS 元数据。

硬性要求：
1. 只输出一个 JSON 对象，不要 markdown 代码块，不要解释。首字符必须是 { ，末字符必须是 } 。
2. 键名固定为：summary（字符串）、show_notes（字符串）。
3. 只使用用户提供的 JSON 中的 episode_hook、facts、topics 与章节时间线中的信息；不得编造未出现的人名、数字、书名或结论。
4. summary：纯文本，无 Markdown、无列表符号；**单段至多 50 个中文字符（含标点）**，用于 RSS/列表摘要；须一句说清「这期具体讲什么、对谁有用」，禁止长段铺陈与堆叠从句。
5. show_notes：Markdown；须含二级标题「## 本期概览」与「## 要点」；facts 较多时合并同类项写成 5～11 条听众可扫读的要点，勿逐字堆叠 JSON。若有节目导听时间线，须追加「## 节目导听」：先用 1～2 句 **加粗** 听法导语（本期主线、适合谁、建议从哪段进入），再列 **至多 8 条** `[分:秒 标题](t:秒数)` 关键锚点（秒须与时间线一致）；切段很多时只保留信息密度最高的若干条，**禁止**把全部段标题无重点地平铺成列表。可酌情增加主流播客常见小节（仅当有素材依据时）：「## 链接与参考」（素材或要点中的 URL/书名/工具）、「## 文稿与追更」（说明正文可在平台查看、RSS 订阅更新），勿写空话。
6. summary 与 show_notes 不可大段同句重复；禁止粘贴口播全文。
7. 语言以简体中文为主。"""


def _invoke_assemble_from_structure(
    user: str, api_key: str | None, *, temperature: float
) -> tuple[dict[str, Any], str | None]:
    messages = [{"role": "system", "content": _SYSTEM_ASSEMBLE_FROM_STRUCTURE}, {"role": "user", "content": user}]
    raw, trace_id = invoke_llm_chat_messages_with_minimax_fallback(
        messages, temperature=temperature, api_key=api_key, timeout_sec=100
    )
    try:
        return _parse_json_object(raw), trace_id
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("share_rss assemble json parse failed, retry once: %s", exc)
        fix_user = (
            "你上一次输出不是合法 JSON。请严格只输出 {\"summary\":\"…\",\"show_notes\":\"…\"}，"
            "不要代码块，不要其它文字。\n\n" + user[:7000]
        )
        raw2, tid2 = invoke_llm_chat_messages_with_minimax_fallback(
            [
                {"role": "system", "content": _SYSTEM_ASSEMBLE_FROM_STRUCTURE},
                {"role": "user", "content": fix_user},
            ],
            temperature=max(0.22, temperature - 0.08),
            api_key=api_key,
            timeout_sec=100,
        )
        return _parse_json_object(raw2), tid2 or trace_id


def _summary_looks_like_markdown(summary: str) -> bool:
    t = (summary or "").strip()
    if not t:
        return True
    if t.startswith("#") or t.startswith("##") or t.startswith("- ") or t.startswith("* "):
        return True
    if "**" in t or "\n##" in t:
        return True
    return False


def _fact_text_seen_in_output(fact: str, hay: str) -> bool:
    """组装稿常改写措辞，用多段子串匹配降低误判为「未覆盖」。"""
    f = fact.strip()
    if len(f) < 6:
        return True
    if f in hay:
        return True
    spans = (0, max(0, len(f) // 5), max(0, len(f) // 3), max(0, len(f) // 2))
    for i in spans:
        for ln in (18, 14, 10):
            frag = f[i : i + ln]
            if len(frag) >= 6 and frag in hay:
                return True
    return False


def _coverage_ok(summary: str, show_notes: str, facts: list[str]) -> bool:
    joined = f"{summary}\n{show_notes}"
    usable = [f for f in facts if isinstance(f, str) and len(f.strip()) >= 8][:10]
    if not usable:
        return True
    hits = sum(1 for f in usable if _fact_text_seen_in_output(f, joined))
    need = 1 if len(usable) <= 4 else max(1, min(2, len(usable) // 3))
    return hits >= need or hits >= max(1, int(len(usable) * 0.28))


def _pair_too_redundant(summary: str, show_notes: str) -> bool:
    a = (summary or "").strip()
    b = re.sub(r"\s+", "", (show_notes or "").replace("#", ""))
    if len(a) < 12 or len(b) < 24:
        return False
    head_b = b[: min(480, len(b))]
    ratio = difflib.SequenceMatcher(None, a[: min(360, len(a))], head_b).ratio()
    return ratio > 0.66


def _structured_row_nonempty(row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    if row.get("facts"):
        return True
    if len(str(row.get("hook_line") or "").strip()) >= 12:
        return True
    if row.get("topics"):
        return True
    return False


def _validate_assembled_pair(
    summary: str,
    show_notes: str,
    merged: dict[str, Any],
) -> str | None:
    """若不合格返回原因字符串，否则返回 None。"""
    if not summary.strip() or not show_notes.strip():
        return "empty"
    if len(summary.strip()) < 8:
        return "summary_short"
    if _summary_looks_like_markdown(summary):
        return "summary_markdown"
    if _pair_too_redundant(summary, show_notes):
        return "redundant"
    facts = merged.get("facts") if isinstance(merged.get("facts"), list) else []
    if facts and not _coverage_ok(summary, show_notes, facts):
        return "low_coverage"
    return None


def _template_assemble_from_structure(merged: dict[str, Any], chapter_timeline_hint: str) -> tuple[str, str]:
    """无 LLM 的确定性兜底。"""
    hook = str(merged.get("episode_hook") or "").strip()
    facts = [str(x).strip() for x in (merged.get("facts") or []) if str(x).strip()]
    topics = [str(x).strip() for x in (merged.get("topics") or []) if str(x).strip()]
    sum_parts: list[str] = []
    if hook:
        sum_parts.append(hook.rstrip("。 "))
    if topics:
        sum_parts.append("涉及：" + "、".join(topics[:4]))
    elif len(facts) > 1:
        sum_parts.append(facts[1].rstrip("。 "))
    elif facts:
        sum_parts.append(facts[0].rstrip("。 "))
    if not sum_parts and facts:
        sum_parts.append(facts[0].rstrip("。 "))
    summary = "。".join(sum_parts) + "。" if sum_parts else "本期节目围绕核心话题展开讨论。"
    summary = re.sub(r"。{2,}", "。", summary)
    if len(summary) > RSS_SUMMARY_MAX_CHARS:
        summary = summary[: RSS_SUMMARY_MAX_CHARS - 1] + "…"

    lines = ["## 本期概览", ""]
    lines.append(hook or (facts[0] if facts else "欢迎收听本期节目。"))
    lines.extend(["", "## 要点", ""])
    for f in facts[:10]:
        lines.append(f"- {f}")
    if topics:
        lines.extend(["", "## 话题", "", "、".join(topics)])
    ch = (chapter_timeline_hint or "").strip()
    if ch:
        listen = _template_program_listen_block(ch, hook, facts)
        if listen:
            lines.extend(["", listen])
    show_notes = "\n".join(lines).strip()
    return summary, show_notes


def _parse_bullets_payload(raw: str) -> list[str]:
    data = _parse_json_object(raw)
    bl = data.get("bullets") or data.get("points") or data.get("要点")
    if not isinstance(bl, list):
        return []
    out: list[str] = []
    for x in bl[:12]:
        s = str(x).strip().replace("\r\n", " ")
        if len(s) >= 4:
            out.append(s[:420])
    return out[:8]


def _share_rss_stage1_extract_bullets(user_base: str, api_key: str | None) -> tuple[list[str], str | None]:
    """两阶段之一：先提炼可核对要点，供二阶段写 summary / show_notes。"""
    system = """你是中文播客编辑。只输出一个 JSON 对象，不要 markdown 代码块，不要解释。首字符必须是 { ，末字符必须是 } 。
键名固定为：bullets（字符串数组）。
bullets：6～9 条，每条一句完整中文，写清听众能复述的「具体信息」：论点、例子、方法、对比、结论或建议；不强制每条都有专有名词或数字，但禁止空泛口号与「本期我们将」「欢迎收听」类废话。
只根据下方用户素材与口播摘要归纳，不要编造素材与口播未出现的事实。"""
    user = (user_base or "").strip()[:14_000]
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    raw, trace_id = invoke_llm_chat_messages_with_minimax_fallback(
        messages, temperature=0.35, api_key=api_key, timeout_sec=90
    )
    try:
        return _parse_bullets_payload(raw), trace_id
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("share_rss_ai bullets json parse failed, retry once: %s", exc)
        fix_user = (
            "你上一次输出不是合法 JSON。请严格只输出 {\"bullets\":[\"…\",\"…\"]}，不要代码块，不要其它文字。\n\n" + user[:10_000]
        )
        raw2, tid2 = invoke_llm_chat_messages_with_minimax_fallback(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": fix_user},
            ],
            temperature=0.28,
            api_key=api_key,
            timeout_sec=90,
        )
        out = _parse_bullets_payload(raw2)
        return out, tid2 or trace_id


def _enrich_merged_with_bullets(
    merged: dict[str, Any],
    user_base: str,
    api_key: str | None,
) -> tuple[dict[str, Any], str | None]:
    """结构化 facts 仍偏少时，用原 bullets 抽取补条，避免要点栏空。"""
    if len(merged.get("facts") or []) >= 3:
        return merged, None
    try:
        bullets, tid = _share_rss_stage1_extract_bullets(user_base, api_key)
    except Exception as exc:
        logger.warning("share_rss enrich bullets skipped: %s", exc)
        return merged, None
    if not bullets:
        return merged, tid
    facts = list(merged.get("facts") or [])
    seen = {str(s)[:100].casefold() for s in facts}
    for b in bullets:
        s = str(b).strip().replace("\r\n", " ")
        if len(s) < 6:
            continue
        k = s[:100].casefold()
        if k in seen:
            continue
        seen.add(k)
        facts.append(s[:420])
    out = dict(merged)
    out["facts"] = facts[:18]
    return out, tid


_SYSTEM_FINAL = """你是中文播客编辑，负责为 RSS / 小宇宙写单集元数据。

硬性要求：
1. 只输出一个 JSON 对象，不要 markdown 代码块，不要解释。首字符必须是 { ，末字符必须是 } 。
2. 键名固定为：summary（字符串）、show_notes（字符串）。
3. summary：纯文本，用于列表摘要 / itunes:summary。**至多 50 字（含标点）**；单句、有具体信息；不要 Markdown、不要多轮对白格式；须吸收「已提炼要点」中的具体信息，禁止空泛口号。
4. show_notes：Markdown 正文，结构完全自由；须有信息增量（要点、结构、听音提示）；**禁止**把口播稿全文或大部粘贴进来；须与「已提炼要点」呼应，可改写扩写，不要逐条复制成纯列表。
5. summary 与 show_notes 不可简单同义重复：summary 偏「这期值不值得听」，show_notes 偏「怎么听、讲什么框架」。
6. 若含章节时间线，show_notes 须有「## 节目导听」：听法导语 + 精选时间锚（至多 8 条），忌流水账罗列。
7. 若合适，时间戳链接可使用 [分:秒 标题](t:秒数) 形式（秒为非负整数）。
8. 语言以简体中文为主。"""


def _share_rss_invoke_summary_json(user: str, api_key: str | None) -> tuple[dict[str, Any], str | None]:
    messages = [{"role": "system", "content": _SYSTEM_FINAL}, {"role": "user", "content": user[:14_000]}]
    raw, trace_id = invoke_llm_chat_messages_with_minimax_fallback(
        messages, temperature=0.42, api_key=api_key, timeout_sec=120
    )
    try:
        return _parse_json_object(raw), trace_id
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("share_rss_ai final json parse failed, retry once: %s", exc)
        fix_user = (
            "你上一次输出不是合法 JSON。请严格只输出一个 JSON 对象，键为 summary 与 show_notes，"
            "不要代码块，不要其它文字。\n\n" + user[:12_000]
        )
        raw2, tid2 = invoke_llm_chat_messages_with_minimax_fallback(
            [
                {"role": "system", "content": _SYSTEM_FINAL},
                {"role": "user", "content": fix_user},
            ],
            temperature=0.32,
            api_key=api_key,
            timeout_sec=120,
        )
        return _parse_json_object(raw2), tid2 or trace_id


def _finalize_summary_show_notes(data: dict[str, Any], trace_id: str | None) -> dict[str, Any]:
    summary = str(data.get("summary") or "").strip().replace("\r\n", "\n")
    show_notes = str(data.get("show_notes") or data.get("showNotes") or "").strip().replace("\r\n", "\n")
    if not summary and not show_notes:
        raise RuntimeError("ai_copy_empty_fields")
    if len(summary) > RSS_SUMMARY_MAX_CHARS:
        summary = summary[: RSS_SUMMARY_MAX_CHARS - 1] + "…"
    if len(show_notes) > SHOW_NOTES_MAX:
        show_notes = show_notes[: SHOW_NOTES_MAX - 1] + "…"
    return {"summary": summary, "show_notes": show_notes, "trace_id": trace_id}


def _legacy_share_rss_from_user_base(
    user_base: str,
    api_key: str | None,
) -> dict[str, Any]:
    """原两阶段 bullets + 终稿；在 Map-Reduce 不可用或结果过弱时回退。"""
    bullets: list[str] = []
    tid_bullets: str | None = None
    try:
        bullets, tid_bullets = _share_rss_stage1_extract_bullets(user_base, api_key)
    except Exception as exc:
        logger.warning("share_rss_ai stage1 bullets skipped: %s", exc)
        bullets = []

    if len(bullets) >= 2:
        bullets_block = "\n".join(f"- {b}" for b in bullets)
        user_two = (
            user_base
            + "\n\n【编辑已提炼要点（summary 与 show_notes 必须体现其中信息，勿逐条照抄成两段列表）】\n"
            + bullets_block
        )
        try:
            data, tid_final = _share_rss_invoke_summary_json(user_two, api_key)
            return _finalize_summary_show_notes(data, tid_final or tid_bullets)
        except Exception as exc:
            logger.warning("share_rss_ai two-stage stage2 failed, fallback single-pass: %s", exc)

    data, trace_id = _share_rss_invoke_summary_json(user_base, api_key)
    return _finalize_summary_show_notes(data, trace_id)


def generate_share_rss_ai_copy(
    *,
    script_raw: str,
    user_source_text: str,
    episode_title_hint: str,
    chapter_timeline_hint: str,
    api_key: str | None = None,
) -> dict[str, Any]:
    """
    返回 summary、show_notes（Markdown）、trace_id（可能为 None）。

    主路径：**全局通读抽取**（整份 user_base）→ **分块 Map 补充** → **合并去重** → facts 仍偏少则 **bullets 补抽** →
    **仅结构化输入**组装 summary/show_notes → **校验** → 重试 → **模板兜底**；
    合并结果仍空时 **回退** 原 bullets 两阶段 / 单段逻辑。
    """
    condensed = condense_script_for_share_llm(script_raw)
    material = (user_source_text or "").strip()
    if len(material) > 6000:
        material = material[:6000] + "…"
    if not condensed.strip() and not material:
        raise RuntimeError("empty_source_for_ai_copy")

    ch_full = (chapter_timeline_hint or "").strip()
    ch_for_llm = _curate_chapter_timeline_for_llm(ch_full, max_items=8) if ch_full else ""

    user_base = _build_share_user_message_blocks(
        condensed=condensed,
        material=material,
        episode_title_hint=episode_title_hint,
        chapter_timeline_hint=ch_for_llm,
    )

    trace_bucket: list[str | None] = []
    material_head = material[:4500] if material else ""
    chapter_head = (ch_for_llm or "").strip()[:2500]

    global_row: dict[str, Any] | None = None
    try:
        global_row, tid_g = _invoke_global_outline_extract(user_base, api_key)
        trace_bucket.append(tid_g)
    except Exception as exc:
        logger.warning("share_rss global outline skipped: %s", exc)
        global_row = None

    chunks = _chunk_condensed_for_map(condensed)
    if len(chunks) > _MAP_MAX_CHUNKS:
        chunks = _rechunk_cap_count(chunks, len(condensed))

    partials: list[dict[str, Any]] = []
    if condensed.strip() and chunks:
        total = len(chunks)
        for idx, ch_text in enumerate(chunks):
            u_map = _build_map_chunk_user_message(
                material_head=material_head,
                episode_title_hint=episode_title_hint,
                chapter_head=chapter_head,
                chunk_index=idx,
                chunk_total=total,
                chunk_text=ch_text,
            )
            try:
                parsed, tid_m = _invoke_map_extract_json(u_map, api_key)
                trace_bucket.append(tid_m)
                partials.append(parsed)
            except Exception as exc:
                logger.warning("share_rss map chunk %s/%s failed: %s", idx + 1, total, exc)

    merge_inputs: list[dict[str, Any]] = []
    if _structured_row_nonempty(global_row):
        merge_inputs.append(global_row)
    merge_inputs.extend(partials)
    merged = _merge_map_partials(merge_inputs)

    merged, tid_enrich = _enrich_merged_with_bullets(merged, user_base, api_key)
    if tid_enrich:
        trace_bucket.append(tid_enrich)

    facts_n = len(merged.get("facts") or [])
    topics_n = len(merged.get("topics") or [])
    hook_ok = len(str(merged.get("episode_hook") or "").strip()) >= 12
    merged_ok = facts_n >= 1 or hook_ok or topics_n >= 1

    if merged_ok:
        assemble_user = _format_assemble_user_message(merged, ch_for_llm, episode_title_hint)
        last_tid: str | None = None
        for attempt, temp in enumerate((0.34, 0.26)):
            try:
                data, tid_a = _invoke_assemble_from_structure(
                    assemble_user, api_key, temperature=temp
                )
                last_tid = tid_a or last_tid
                trace_bucket.append(tid_a)
                pack = _finalize_summary_show_notes(data, tid_a)
                reason = _validate_assembled_pair(
                    str(pack.get("summary") or ""),
                    str(pack.get("show_notes") or ""),
                    merged,
                )
                if reason is None:
                    return pack
                logger.warning(
                    "share_rss assemble validation failed (%s), attempt=%s", reason, attempt
                )
            except Exception as exc:
                logger.warning("share_rss assemble invoke failed attempt=%s: %s", attempt, exc)

        try:
            s_t, n_t = _template_assemble_from_structure(merged, ch_full)
            for tid in reversed(trace_bucket):
                if tid:
                    last_tid = tid
                    break
            return _finalize_summary_show_notes(
                {"summary": s_t, "show_notes": n_t},
                last_tid,
            )
        except Exception as exc:
            logger.warning("share_rss template assemble failed: %s", exc)

    return _legacy_share_rss_from_user_base(user_base, api_key)


def _utc_iso_z() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def try_attach_auto_share_rss_to_result(
    *,
    job_id: str,
    payload: dict[str, Any],
    result: dict[str, Any],
    api_key: str | None,
) -> None:
    """
    播客成片落库前：生成 RSS 简介与 Shownotes 写入 result（auto_share_*），失败不影响成片成功。

    环境变量 AUTO_SHARE_RSS_AI=0|false|no|off 时跳过。
    """
    flag = os.getenv("AUTO_SHARE_RSS_AI", "1").strip().lower()
    if flag in ("0", "false", "no", "off"):
        return
    if not isinstance(result, dict):
        return
    pl = payload if isinstance(payload, dict) else {}
    try:
        row = {"result": result, "payload": pl}
        script_raw = resolve_script_body_for_share(job_id, row)
        user_source = build_share_user_source_text(pl, result)
        if not script_raw.strip() and not user_source.strip():
            return
        title_hint = (
            str(pl.get("episode_title") or pl.get("podcast_title") or "").strip()
            or str(result.get("title") or "").strip()
            or str(pl.get("program_name") or "").strip()
        )[:300]
        chapter_hint = format_audio_chapters_hint(result)
        pack = generate_share_rss_ai_copy(
            script_raw=script_raw,
            user_source_text=user_source,
            episode_title_hint=title_hint,
            chapter_timeline_hint=chapter_hint,
            api_key=api_key,
        )
        summary = str(pack.get("summary") or "").strip()
        show_notes = str(pack.get("show_notes") or "").strip()
        if not summary and not show_notes:
            return
        result["auto_share_summary"] = summary
        result["auto_share_show_notes"] = show_notes
        tid = pack.get("trace_id")
        if tid:
            result["auto_share_ai_trace_id"] = str(tid)
        result["auto_share_ai_generated_at"] = _utc_iso_z()
    except Exception as exc:
        logger.warning("auto_share_rss_ai failed job_id=%s: %s", job_id, exc, exc_info=True)

"""个人特色 IP：风格解析（Resolver）与成文（compose）。"""
from __future__ import annotations

import json
import re
from typing import Any

from .author_ip_store import get_author_ip
from .models import list_notes
from .provider_router import (
    invoke_llm_chat_messages_stream_iter,
    invoke_llm_chat_messages_with_minimax_fallback,
)

_CONTENT_TYPE_CN = {
    "article": "通用文章",
    "wechat_mp": "公众号图文",
    "xiaohongshu": "小红书笔记",
    "short_post": "短帖",
}

_TARGET_CHARS = {
    "article": 1500,
    "wechat_mp": 2000,
    "xiaohongshu": 900,
    "short_post": 500,
}

_CHAR_PRESETS = {
    "article": [800, 1500, 2500],
    "wechat_mp": [1200, 2000, 3500],
    "xiaohongshu": [600, 900, 1200],
    "short_post": [300, 500, 800],
}

TRIAL_MAX_CHARS = 120


def _md_dict(row: dict[str, Any]) -> dict[str, Any]:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except Exception:
            md = {}
    return md if isinstance(md, dict) else {}


def _topic_tokens(topic: str) -> set[str]:
    raw = re.findall(r"[\u4e00-\u9fff]{2,}|[a-zA-Z0-9]{2,}", (topic or "").lower())
    stop = {"一篇", "如何", "怎么", "是否", "值得", "关于", "我们", "你们", "可以", "这个", "那个"}
    return {t for t in raw if t not in stop and len(t) >= 2}


def list_ip_materials(user_ref: str | None, ip_item: dict[str, Any]) -> list[dict[str, Any]]:
    nb = str(ip_item.get("notebookName") or "").strip()
    if not nb:
        return []
    rows = list_notes(user_ref=user_ref, notebook=nb, limit=200, offset=0)
    out: list[dict[str, Any]] = []
    for row in rows or []:
        md = _md_dict(row)
        body = str(row.get("content_text") or "").strip()
        include_learn = md.get("includeInStyleLearning")
        if include_learn is False:
            include_flag = False
        else:
            include_flag = True
        out.append(
            {
                "noteId": str(row.get("id") or ""),
                "title": str(md.get("title") or "未命名").strip()[:200],
                "body": body,
                "materialType": str(md.get("authorMaterialType") or "published").strip(),
                "experienceTemplateId": str(md.get("experienceTemplateId") or "").strip(),
                "includeInStyleLearning": include_flag,
            }
        )
    return out


def _pick_traits(profile: dict[str, Any]) -> list[dict[str, Any]]:
    traits = profile.get("traits") if isinstance(profile.get("traits"), list) else []
    picked: list[dict[str, Any]] = []
    for tr in traits:
        if not isinstance(tr, dict):
            continue
        if tr.get("defaultOn") is False:
            continue
        label = str(tr.get("label") or "").strip()
        if label:
            picked.append(tr)
    return picked[:12]


def _pick_domain(profile: dict[str, Any], topic: str) -> tuple[str, str, str]:
    """返回 displayName, confidence(high|medium|low), internal key。"""
    domains = profile.get("domains") if isinstance(profile.get("domains"), list) else []
    if not domains:
        return "通用写作", "high", "general"
    tokens = _topic_tokens(topic)
    best_name = ""
    best_key = "general"
    best_score = -1
    second_score = -1
    for i, dom in enumerate(domains):
        if not isinstance(dom, dict):
            continue
        name = str(dom.get("displayName") or f"场景{i + 1}").strip()
        bound = []
        for key in ("boundArticleTitles", "boundExperienceTemplates"):
            arr = dom.get(key)
            if isinstance(arr, list):
                bound.extend(str(x) for x in arr)
        blob = " ".join(bound) + " " + name
        score = sum(1 for t in tokens if t in blob)
        if score > best_score:
            second_score = best_score
            best_score = score
            best_name = name
            best_key = f"dom_{i}"
        elif score > second_score:
            second_score = score
    if not best_name and domains:
        d0 = domains[0]
        if isinstance(d0, dict):
            best_name = str(d0.get("displayName") or "通用写作")
    if not best_name:
        best_name = "通用写作"
    if best_score <= 0:
        return best_name, "medium", best_key
    if best_score > 0 and (best_score - max(second_score, 0)) >= 1:
        return best_name, "high", best_key
    return best_name, "medium", best_key


def _pick_experiences(
    materials: list[dict[str, Any]],
    topic: str,
    *,
    level: str = "default",
) -> list[dict[str, Any]]:
    limit = {"less": 1, "more": 3}.get(level, 2)
    tokens = _topic_tokens(topic)
    exp_rows = [m for m in materials if m.get("materialType") == "experience_card" and m.get("body")]
    scored: list[tuple[int, dict[str, Any]]] = []
    for m in exp_rows:
        blob = (m.get("title") or "") + " " + (m.get("body") or "")[:400]
        score = sum(2 for t in tokens if t in blob) + (1 if tokens else 0)
        scored.append((score, m))
    scored.sort(key=lambda x: x[0], reverse=True)
    if not scored and exp_rows:
        return exp_rows[:limit]
    return [m for _, m in scored[:limit]]


def _pick_article_excerpts(materials: list[dict[str, Any]], limit: int = 2) -> list[dict[str, Any]]:
    pubs = [
        m
        for m in materials
        if m.get("materialType") in ("published", "draft") and m.get("body")
    ]
    out: list[dict[str, Any]] = []
    for m in pubs[:limit]:
        body = str(m.get("body") or "")
        out.append(
            {
                "title": m.get("title"),
                "excerpt": body[:600],
            }
        )
    return out


def resolve_author_style(
    user_ref: str | None,
    ip_id: str,
    *,
    topic: str,
    outline: str = "",
    content_type: str = "article",
    experience_level: str = "default",
) -> dict[str, Any]:
    ip_item = get_author_ip(user_ref, ip_id)
    if not ip_item:
        raise ValueError("ip_not_found")
    profile = ip_item.get("profile") if isinstance(ip_item.get("profile"), dict) else {}
    materials = list_ip_materials(user_ref, ip_item)
    scene_name, confidence, _ = _pick_domain(profile, topic)
    traits = _pick_traits(profile)
    experiences = _pick_experiences(materials, topic, level=experience_level)
    ctype_label = _CONTENT_TYPE_CN.get(content_type, "通用文章")
    topic_s = (topic or "").strip()[:120]
    exp_titles = [str(e.get("title") or "") for e in experiences if e.get("title")]
    if topic_s and exp_titles:
        resolver_line = f"根据主题「{topic_s}」匹配「{scene_name}」口吻，并引用「{exp_titles[0]}」"
        if len(exp_titles) > 1:
            resolver_line += f"等 {len(exp_titles)} 条经历"
        resolver_line += "。"
    elif topic_s:
        resolver_line = f"根据主题「{topic_s}」匹配「{scene_name}」口吻。"
    else:
        resolver_line = f"已匹配「{scene_name}」口吻（{ctype_label}）。"
    return {
        "authorIpId": ip_id,
        "displayName": ip_item.get("displayName"),
        "sceneName": scene_name,
        "contentType": content_type,
        "contentTypeLabel": ctype_label,
        "confidence": confidence,
        "resolverLine": resolver_line,
        "traitLabels": [str(t.get("label") or "") for t in traits],
        "experienceNoteIds": [str(e.get("noteId") or "") for e in experiences],
        "experienceTitles": exp_titles,
        "maturity": ip_item.get("maturity"),
    }


def build_style_prompt_block(
    ip_item: dict[str, Any],
    *,
    traits: list[dict[str, Any]],
    experiences: list[dict[str, Any]],
    article_excerpts: list[dict[str, Any]],
    content_type: str,
    scene_name: str,
) -> str:
    lines = [
        f"【作者身份】{ip_item.get('oneLiner') or ip_item.get('displayName')}",
        f"【写作场景】{scene_name}",
        f"【体裁】{_CONTENT_TYPE_CN.get(content_type, '通用文章')}",
    ]
    if traits:
        lines.append("【表达特色（须体现）】")
        for tr in traits[:10]:
            dim = str(tr.get("dimension") or "").strip()
            label = str(tr.get("label") or "").strip()
            ev = str(tr.get("evidence") or "").strip()
            lines.append(f"- {dim}·{label}" + (f"（例：{ev[:80]}）" if ev else ""))
    taboos = []
    for tr in traits:
        if str(tr.get("dimension") or "") == "禁区":
            taboos.append(str(tr.get("label") or ""))
    if taboos:
        lines.append("【禁用】 " + "；".join(taboos))
    if experiences:
        lines.append("【个人经历素材——仅可使用以下内容中的事实，不得编造未出现过的经历】")
        for ex in experiences:
            lines.append(f"### {ex.get('title')}\n{str(ex.get('body') or '')[:1200]}")
    elif article_excerpts:
        lines.append("【文风参考摘录——学节奏与结构，勿照抄】")
        for ax in article_excerpts:
            lines.append(f"### {ax.get('title')}\n{str(ax.get('excerpt') or '')[:500]}")
    else:
        lines.append(
            "【提示】作者素材较少，请保持克制、短句，避免编造具体个人经历；可用概括性表述。"
        )
    return "\n\n".join(lines)


def _build_compose_messages(
    user_ref: str | None,
    ip_id: str,
    *,
    topic: str,
    outline: str = "",
    content_type: str = "article",
    use_author_style: bool = True,
    experience_level: str = "default",
    target_chars: int | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, str]], list[dict[str, Any]], int]:
    """返回 ip_item, resolved, messages, experiences, chars。"""
    topic_s = (topic or "").strip()
    if not topic_s:
        raise ValueError("topic_required")
    ip_item = get_author_ip(user_ref, ip_id)
    if not ip_item:
        raise ValueError("ip_not_found")

    resolved = resolve_author_style(
        user_ref,
        ip_id,
        topic=topic_s,
        outline=outline,
        content_type=content_type,
        experience_level=experience_level,
    )
    materials = list_ip_materials(user_ref, ip_item)
    profile = ip_item.get("profile") if isinstance(ip_item.get("profile"), dict) else {}
    traits = _pick_traits(profile)
    experiences = [
        m
        for m in materials
        if str(m.get("noteId") or "") in set(resolved.get("experienceNoteIds") or [])
    ]
    if not experiences:
        experiences = _pick_experiences(materials, topic_s, level=experience_level)
    excerpts = _pick_article_excerpts(materials)
    chars = target_chars or _TARGET_CHARS.get(content_type, 1500)

    if use_author_style:
        style_block = build_style_prompt_block(
            ip_item,
            traits=traits,
            experiences=experiences,
            article_excerpts=excerpts,
            content_type=content_type,
            scene_name=str(resolved.get("sceneName") or "通用写作"),
        )
        system = (
            "你是该作者的写作分身。严格遵循下方【作者身份】与【表达特色】，"
            "个人经历仅来自给定素材，禁止捏造未提供的经历、数据与客户名称。"
            "输出 Markdown 正文，不要输出 JSON，不要用代码块包裹全文。"
        )
        user_parts = [style_block, f"【主题】{topic_s}"]
        if outline.strip():
            user_parts.append(f"【大纲】\n{outline.strip()[:4000]}")
        cap_note = f"约 {chars} 字" if chars > TRIAL_MAX_CHARS else f"严格不超过 {chars} 字"
        user_parts.append(f"【目标字数】{cap_note}（正文）")
        if chars <= TRIAL_MAX_CHARS:
            user_parts.append("【试写】仅输出一段精炼正文，不要标题与多余解释。")
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": "\n\n".join(user_parts)},
        ]
    else:
        cap_note = f"约 {chars} 字" if chars > TRIAL_MAX_CHARS else f"不超过 {chars} 字"
        messages = [
            {
                "role": "system",
                "content": "你是专业中文写作者。输出 Markdown 正文，不要 JSON。",
            },
            {
                "role": "user",
                "content": f"主题：{topic_s}\n大纲：{outline or '无'}\n目标{cap_note}",
            },
        ]
    return ip_item, resolved, messages, experiences, chars


def iter_compose_author_article_events(
    user_ref: str | None,
    ip_id: str,
    *,
    topic: str,
    outline: str = "",
    content_type: str = "article",
    use_author_style: bool = True,
    experience_level: str = "default",
    target_chars: int | None = None,
):
    """SSE 事件：resolver → chunk* → done | error。"""
    _ip_item, resolved, messages, experiences, _chars = _build_compose_messages(
        user_ref,
        ip_id,
        topic=topic,
        outline=outline,
        content_type=content_type,
        use_author_style=use_author_style,
        experience_level=experience_level,
        target_chars=target_chars,
    )
    yield {"type": "resolver", "resolver": resolved}
    parts: list[str] = []
    for piece in invoke_llm_chat_messages_stream_iter(
        messages,
        temperature=0.55,
        timeout_sec=120,
    ):
        if piece:
            parts.append(piece)
            yield {"type": "chunk", "text": piece}
    body = "".join(parts).strip()
    if not body:
        yield {"type": "error", "code": "compose_empty"}
        return
    cited = [str(e.get("title") or "") for e in experiences if e.get("title")]
    imprint = {
        "sceneName": resolved.get("sceneName"),
        "contentTypeLabel": resolved.get("contentTypeLabel"),
        "citedExperiences": cited,
        "diffSummary": "相较通用写法，更强调结论前置、个人口吻与给定经历素材。" if use_author_style else "",
        "usedAuthorStyle": use_author_style,
    }
    yield {
        "type": "done",
        "body": body,
        "resolver": resolved,
        "imprint": imprint,
    }


def trial_compose_author_snippet(
    user_ref: str | None,
    ip_id: str,
    *,
    topic: str,
    content_type: str = "article",
) -> dict[str, Any]:
    """试写室：约 120 字验证口吻。"""
    topic_s = (topic or "").strip()
    if not topic_s:
        raise ValueError("topic_required")
    return compose_author_article(
        user_ref,
        ip_id,
        topic=topic_s,
        content_type=content_type,
        use_author_style=True,
        experience_level="less",
        target_chars=TRIAL_MAX_CHARS,
    )


def compose_author_article(
    user_ref: str | None,
    ip_id: str,
    *,
    topic: str,
    outline: str = "",
    content_type: str = "article",
    use_author_style: bool = True,
    experience_level: str = "default",
    target_chars: int | None = None,
) -> dict[str, Any]:
    _ip_item, resolved, messages, experiences, chars = _build_compose_messages(
        user_ref,
        ip_id,
        topic=topic,
        outline=outline,
        content_type=content_type,
        use_author_style=use_author_style,
        experience_level=experience_level,
        target_chars=target_chars,
    )

    body, _ = invoke_llm_chat_messages_with_minimax_fallback(
        messages,
        temperature=0.55,
        timeout_sec=120,
        max_tokens=min(8192, max(1024, chars * 2)),
    )
    if not body:
        raise RuntimeError("compose_empty")

    cited = [str(e.get("title") or "") for e in experiences if e.get("title")]
    imprint = {
        "sceneName": resolved.get("sceneName"),
        "contentTypeLabel": resolved.get("contentTypeLabel"),
        "citedExperiences": cited,
        "diffSummary": "相较通用写法，更强调结论前置、个人口吻与给定经历素材。" if use_author_style else "",
        "usedAuthorStyle": use_author_style,
    }
    return {
        "body": body.strip(),
        "resolver": resolved,
        "imprint": imprint,
    }


def record_style_feedback(
    user_ref: str | None,
    ip_id: str,
    *,
    liked: bool,
    reason: str | None = None,
) -> None:
    """轻量反馈：写入 profile_json.feedbackHints，供后续提示（M1 可接降权）。"""
    from .db import get_conn, get_cursor
    from .models._core import _resolve_user_uuid_or_none

    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return
            cur.execute(
                """
                SELECT profile_json FROM author_ips
                WHERE user_id = %s::uuid AND id = %s::uuid AND archived_at IS NULL
                """,
                (user_uuid, ip_id),
            )
            row = cur.fetchone()
            if not row:
                return
            prof = row.get("profile_json") or {}
            if isinstance(prof, str):
                try:
                    prof = json.loads(prof)
                except Exception:
                    prof = {}
            if not isinstance(prof, dict):
                prof = {}
            hints = prof.get("feedbackHints") if isinstance(prof.get("feedbackHints"), list) else []
            hints.append(
                {
                    "liked": bool(liked),
                    "reason": (reason or "").strip()[:80],
                }
            )
            prof["feedbackHints"] = hints[-20:]
            cur.execute(
                """
                UPDATE author_ips SET profile_json = %s::jsonb, updated_at = NOW()
                WHERE user_id = %s::uuid AND id = %s::uuid
                """,
                (json.dumps(prof, ensure_ascii=False), user_uuid, ip_id),
            )
            conn.commit()

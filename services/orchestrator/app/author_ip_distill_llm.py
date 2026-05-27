"""个人特色 IP：LLM 蒸馏 trait / 词云 / 场景。"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from .author_ip_distill import (
    TRAIT_DIMENSIONS,
    _learning_materials,
    _normalize_trait,
)
from .provider_router import invoke_llm_chat_messages_with_minimax_fallback

logger = logging.getLogger(__name__)

_MAX_MATERIALS = 14
_MAX_BODY_PER_MAT = 2200
_MAX_USER_CHARS = 14_000

_SYSTEM_FULL = """你是个人写作风格分析师。根据作者的定位与素材（简历、成稿），提炼可复用的「表达特色」供 AI 写作时遵循。

规则：
1. 只输出一个 JSON 对象，不要 Markdown 代码块，不要其它说明。
2. 特色必须来自素材，禁止捏造素材中未出现的个人经历、公司、数据。
3. trait 聚焦「怎么写」（口吻、结构、立场、禁区、平台习惯），不要复述事实百科。
4. dimension 必须使用：立场、结构、语气、修辞、禁区、平台（「口吻」归入「语气」）。
5. traits 总数 10～16 条；每个有证据的 dimension 至少 2 条不同 label，避免只写「结论前置」一类笼统项。
6. 同一 dimension 下多条 trait 写在一起（JSON 数组顺序按 dimension 分组：立场→结构→语气→修辞→禁区→平台）。
7. evidence 为素材中的短摘录或概括（≤80 字）。
8. tagCloud 为 8～12 个中文关键词或短语（2～8 字为主），覆盖口吻、结构、话题，避免近义重复。
9. domains 为 1～4 个写作场景；每个场景 displayName 简短；boundArticleTitles 填相关成稿标题（来自素材）。
10. recentChange 用一句话说明本次相较「已有特色」的新增或强化（若无变化可写「延续既有风格」）。

JSON 结构：
{
  "tagCloud": ["关键词", "..."],
  "traits": [
    {"dimension": "立场", "label": "结论前置", "evidence": "…", "defaultOn": true, "confidence": 0.85}
  ],
  "domains": [
    {"displayName": "测评种草", "boundArticleTitles": ["文章标题"], "boundExperienceTemplates": []}
  ],
  "recentChange": "…"
}"""

_SYSTEM_LITE = """你是写作风格分析师。根据素材提炼 6～10 个中文关键词 tagCloud，并一句话 recentChange。

只输出 JSON：{"tagCloud":["…"],"recentChange":"…"}
不要代码块，不要其它文字。"""


def distill_llm_enabled() -> bool:
    raw = str(os.getenv("AUTHOR_IP_DISTILL_LLM", "1")).strip().lower()
    return raw not in ("0", "false", "no", "off")


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


def _truncate(s: str, n: int) -> str:
    s = (s or "").strip()
    if len(s) <= n:
        return s
    return s[: n - 1] + "…"


def build_distill_user_payload(
    materials: list[dict[str, Any]],
    *,
    one_liner: str = "",
    existing_traits: list[dict[str, Any]] | None = None,
    mode: str = "full",
) -> str:
    lines: list[str] = []
    if one_liner.strip():
        lines.append(f"【一句话定位】{one_liner.strip()}")
    if existing_traits and mode == "full":
        labels = [
            f"{t.get('dimension', '')}·{t.get('label', '')}"
            for t in existing_traits[:16]
            if isinstance(t, dict) and t.get("label")
        ]
        if labels:
            lines.append("【已有特色（可延续或更新）】" + "；".join(labels[:12]))

    lines.append("【参与学习的素材】")
    for i, m in enumerate(_learning_materials(materials)[:_MAX_MATERIALS], 1):
        title = str(m.get("title") or "未命名").strip()
        mt = str(m.get("materialType") or "")
        tid = str(m.get("experienceTemplateId") or "").strip()
        raw = str(m.get("distillBody") or m.get("body") or "")
        body = _truncate(raw, _MAX_BODY_PER_MAT)
        src = str(m.get("distillSourceKind") or "full_body")
        meta = f"type={mt}, distill={src}" + (f", template={tid}" if tid else "")
        lines.append(f"\n--- 素材{i}：{title} ({meta}) ---\n{body or '（无正文）'}")

    text = "\n".join(lines).strip()
    return text[:_MAX_USER_CHARS]


def _parse_traits(raw_list: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_list, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        dim = str(item.get("dimension") or "语气").strip()
        if dim == "口吻":
            dim = "语气"
        if dim not in TRAIT_DIMENSIONS:
            dim = "语气"
        n = _normalize_trait(
            {
                "dimension": dim,
                "label": item.get("label"),
                "evidence": item.get("evidence"),
                "defaultOn": item.get("defaultOn", True),
                "confidence": item.get("confidence", 0.8),
            }
        )
        if n:
            out.append(n)
    return out


def _parse_tag_cloud(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for x in raw:
        s = str(x).strip()[:16]
        if len(s) < 2 or s in seen:
            continue
        seen.add(s)
        out.append(s)
        if len(out) >= 14:
            break
    return out


def _parse_domains(raw: Any, materials: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    valid_titles = {
        str(m.get("title") or "").strip()
        for m in _learning_materials(materials)
        if str(m.get("title") or "").strip()
    }
    out: list[dict[str, Any]] = []
    for i, dom in enumerate(raw[:4]):
        if not isinstance(dom, dict):
            continue
        name = str(dom.get("displayName") or f"场景{i + 1}").strip()[:80]
        titles = []
        for t in dom.get("boundArticleTitles") or []:
            ts = str(t).strip()[:200]
            if ts and (not valid_titles or ts in valid_titles or any(ts in v or v in ts for v in valid_titles)):
                titles.append(ts)
        tpls = [
            str(x).strip()[:80]
            for x in (dom.get("boundExperienceTemplates") or [])
            if str(x).strip()
        ][:8]
        out.append(
            {
                "displayName": name or f"场景{i + 1}",
                "boundArticleTitles": titles[:8],
                "boundExperienceTemplates": tpls,
            }
        )
    return out


def _invoke_distill_json(
    system: str,
    user: str,
    *,
    temperature: float = 0.35,
    timeout_sec: int = 90,
) -> dict[str, Any]:
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    raw, _tid = invoke_llm_chat_messages_with_minimax_fallback(
        messages,
        temperature=temperature,
        timeout_sec=timeout_sec,
        max_tokens=4096,
    )
    try:
        return _parse_json_object(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("author_ip_distill llm json parse failed, retry: %s", exc)
        fix_user = (
            "上一次输出不是合法 JSON。请严格只输出要求的 JSON 对象，不要代码块。\n\n" + user[:12_000]
        )
        raw2, _ = invoke_llm_chat_messages_with_minimax_fallback(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": fix_user},
            ],
            temperature=0.28,
            timeout_sec=timeout_sec,
            max_tokens=4096,
        )
        return _parse_json_object(raw2)


def distill_profile_with_llm(
    materials: list[dict[str, Any]],
    *,
    one_liner: str = "",
    existing_traits: list[dict[str, Any]] | None = None,
    mode: str = "full",
) -> dict[str, Any] | None:
    """
    调用 LLM 蒸馏。成功返回 { tagCloud, traits?, domains?, recentChange }；
    失败返回 None（由调用方回退规则引擎）。
    """
    if not distill_llm_enabled():
        return None
    user = build_distill_user_payload(
        materials,
        one_liner=one_liner,
        existing_traits=existing_traits,
        mode=mode,
    )
    if len(user) < 40:
        return None

    try:
        if mode == "lite":
            data = _invoke_distill_json(_SYSTEM_LITE, user, temperature=0.3, timeout_sec=60)
            tags = _parse_tag_cloud(data.get("tagCloud"))
            change = str(data.get("recentChange") or "").strip()[:240]
            if not tags:
                return None
            return {"tagCloud": tags, "recentChange": change, "traits": [], "domains": []}

        data = _invoke_distill_json(_SYSTEM_FULL, user, temperature=0.38, timeout_sec=100)
        tags = _parse_tag_cloud(data.get("tagCloud"))
        traits = _parse_traits(data.get("traits"))
        domains = _parse_domains(data.get("domains"), materials)
        change = str(data.get("recentChange") or "").strip()[:240]
        if not tags and not traits:
            return None
        return {
            "tagCloud": tags,
            "traits": traits,
            "domains": domains,
            "recentChange": change,
        }
    except Exception as exc:
        logger.warning("author_ip_distill llm failed: %s", exc)
        return None


_SYSTEM_MERGE = """你是写作风格整合师。输入为多篇资料「已预提取的风格要点」（非全文），请合并为作者统一风格画像。

规则：
1. 只输出一个 JSON 对象，不要 Markdown 代码块。
2. 不得捏造素材未出现的经历、公司、数据。
3. trait 聚焦怎么写（口吻、结构、立场、禁区、平台）；dimension 用：立场、结构、语气、修辞、禁区、平台。
4. traits 10～16 条，每个 dimension 尽量 2 条以上且 label 互不重复；tagCloud 8～12 个；domains 1～4 个；recentChange 一句话。
5. 合并时保留各资料差异点（如不同体裁的结构习惯），勿过度归纳成单一句式。

JSON 结构同完整蒸馏（tagCloud, traits, domains, recentChange）。"""

_SYSTEM_FEATURES_ENRICH = """你是写作风格分析师。根据单篇资料提要，补充 3～5 个口吻关键词（toneHints）与 5～8 个 tagHints。

只输出 JSON：{"toneHints":["…"],"tagHints":["…"]}
不要其它文字。"""


def build_merge_features_user_payload(
    materials: list[dict[str, Any]],
    *,
    one_liner: str = "",
    existing_traits: list[dict[str, Any]] | None = None,
) -> str:
    from .note_style_features import format_style_features_block

    lines: list[str] = []
    if one_liner.strip():
        lines.append(f"【一句话定位】{one_liner.strip()}")
    if existing_traits:
        labels = [
            f"{t.get('dimension', '')}·{t.get('label', '')}"
            for t in existing_traits[:16]
            if isinstance(t, dict) and t.get("label")
        ]
        if labels:
            lines.append("【已有特色】" + "；".join(labels[:12]))
    lines.append("【各资料预提取风格要点】")
    for i, m in enumerate(materials[:16], 1):
        sf = m.get("styleFeatures") if isinstance(m.get("styleFeatures"), dict) else {}
        title = str(m.get("title") or f"资料{i}")
        block = format_style_features_block(sf, title=title)
        lines.append(f"\n--- {title} ---\n{block or '（无）'}")
    return "\n".join(lines)[:_MAX_USER_CHARS]


def distill_profile_merge_features(
    materials: list[dict[str, Any]],
    *,
    one_liner: str = "",
    existing_traits: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """P2：基于 per-note styleFeatures 单次聚合为人设，不灌全文。"""
    if not distill_llm_enabled():
        return None
    user = build_merge_features_user_payload(
        materials, one_liner=one_liner, existing_traits=existing_traits
    )
    if len(user) < 40:
        return None
    try:
        data = _invoke_distill_json(_SYSTEM_MERGE, user, temperature=0.42, timeout_sec=90)
        tags = _parse_tag_cloud(data.get("tagCloud"))
        traits = _parse_traits(data.get("traits"))
        domains = _parse_domains(data.get("domains"), materials)
        change = str(data.get("recentChange") or "").strip()[:240]
        if not tags and not traits:
            return None
        return {
            "tagCloud": tags,
            "traits": traits,
            "domains": domains,
            "recentChange": change,
        }
    except Exception as exc:
        logger.warning("author_ip_distill merge_features failed: %s", exc)
        return None


def enrich_style_features_with_llm(
    features: dict[str, Any],
    *,
    title: str,
    excerpt: str,
    api_key: str | None = None,
) -> dict[str, Any]:
    if not distill_llm_enabled():
        return features
    user = f"【标题】{title[:120]}\n【提要】\n{(excerpt or '')[:2400]}"
    try:
        data = _invoke_distill_json(_SYSTEM_FEATURES_ENRICH, user, temperature=0.25, timeout_sec=45)
        tones = data.get("toneHints") if isinstance(data.get("toneHints"), list) else []
        tags = data.get("tagHints") if isinstance(data.get("tagHints"), list) else []
        out = dict(features)
        if tones:
            merged = list(dict.fromkeys([*out.get("toneHints", []), *[str(t) for t in tones if str(t).strip()]]))
            out["toneHints"] = merged[:8]
        if tags:
            merged = list(dict.fromkeys([*out.get("tagHints", []), *[str(t) for t in tags if str(t).strip()]]))
            out["tagHints"] = merged[:12]
        out["extractKind"] = "llm_lite"
        return out
    except Exception as exc:
        logger.warning("enrich_style_features_with_llm failed: %s", exc)
        return features


"""自媒体文案合规：预检 + 规则软化 + 必要时 DeepSeek 改写（仅返回终稿）。"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from .provider_router import invoke_llm_chat_messages_deepseek_only
from .social_llm_utils import format_hashtag_line

logger = logging.getLogger(__name__)

# (pattern, category, replacement) — 按顺序替换，pattern 可为简单子串（小写匹配）
_RULE_REPLACEMENTS: list[tuple[str, str, str]] = [
    ("最好", "absolute", "我个人觉得不错"),
    ("最佳", "absolute", "比较出彩"),
    ("第一", "absolute", "名列前茅"),
    ("顶级", "absolute", "高口碑"),
    ("100%", "absolute", "很大比例"),
    ("绝对", "absolute", "比较"),
    ("根治", "medical", "改善感受"),
    ("治愈", "medical", "缓解"),
    ("疗效", "medical", "使用感受"),
    ("治疗", "medical", "护理"),
    ("药效", "medical", "成分表现"),
    ("加微信", "drainage", "主页合集"),
    ("加v", "drainage", "主页看看"),
    ("加V", "drainage", "主页看看"),
    ("私信领取", "drainage", "评论区交流"),
    ("私信我", "drainage", "评论区留言"),
    ("点击链接", "drainage", "戳主页"),
    ("扫码领取", "drainage", "戳主页"),
    ("vx", "drainage", ""),
    ("v信", "drainage", ""),
    ("三天变白", "exaggeration", "坚持一段时间更有感"),
    (" garantee", "exaggeration", ""),
    ("保证治愈", "exaggeration", "因人而异"),
    ("必瘦", "exaggeration", "更有线条感"),
    ("最强", "absolute", "很能打"),
]

_SAFE_CTA_INTERACT = "姐妹们评论区聊聊你的体验～"
_SAFE_CTA_SAVE = "觉得有用先马住，不然刷新就找不着啦～"


@dataclass
class ComplianceHit:
    field: str
    span: str
    category: str
    suggestion: str


@dataclass
class ComplianceScanResult:
    passed: bool
    hits: list[ComplianceHit] = field(default_factory=list)
    severity: str = "none"  # none | light | medium | heavy

    @property
    def categories(self) -> list[str]:
        return sorted({h.category for h in self.hits})


def _severity_from_hits(hits: list[ComplianceHit]) -> str:
    if not hits:
        return "none"
    cats = {h.category for h in hits}
    if "drainage" in cats or len(hits) >= 6:
        return "heavy"
    if "medical" in cats or len(hits) >= 3:
        return "medium"
    return "light"


def scan_text(text: str, field_name: str = "text") -> list[ComplianceHit]:
    raw = str(text or "")
    if not raw.strip():
        return []
    lower = raw.lower()
    hits: list[ComplianceHit] = []
    seen: set[tuple[str, str]] = set()
    for pattern, category, suggestion in _RULE_REPLACEMENTS:
        p_low = pattern.lower()
        if p_low not in lower and pattern not in raw:
            continue
        key = (field_name, pattern)
        if key in seen:
            continue
        seen.add(key)
        hits.append(
            ComplianceHit(
                field=field_name,
                span=pattern,
                category=category,
                suggestion=suggestion,
            )
        )
    return hits


def scan_xhs_fields(fields: dict[str, str]) -> ComplianceScanResult:
    all_hits: list[ComplianceHit] = []
    for name, val in fields.items():
        all_hits.extend(scan_text(val, name))
    sev = _severity_from_hits(all_hits)
    return ComplianceScanResult(passed=len(all_hits) == 0, hits=all_hits, severity=sev)


def rule_soften_text(text: str) -> tuple[str, int]:
    out = str(text or "")
    n = 0
    for pattern, _cat, repl in _RULE_REPLACEMENTS:
        if pattern in out:
            out = out.replace(pattern, repl, 1)
            n += 1
        elif pattern.lower() in out.lower():
            idx = out.lower().find(pattern.lower())
            if idx >= 0:
                out = out[:idx] + repl + out[idx + len(pattern) :]
                n += 1
    out = re.sub(r" {2,}", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out, n


def rule_soften_xhs_fields(fields: dict[str, str]) -> tuple[dict[str, str], int]:
    total = 0
    out: dict[str, str] = {}
    for k, v in fields.items():
        softened, n = rule_soften_text(v)
        out[k] = softened
        total += n
    return out, total


def _llm_soften_xhs_json(fields: dict[str, str], scan: ComplianceScanResult) -> dict[str, str]:
    """保留键与字数约束，仅做合规改写。"""
    payload = json.dumps(fields, ensure_ascii=False)
    hit_summary = ", ".join(f"{h.field}:{h.category}" for h in scan.hits[:12]) or "none"
    system = """你是小红书文案合规编辑。用户会给你一篇笔记各字段的 JSON（已是发布终稿结构）。
请仅做合规软化：去掉绝对化、医疗承诺、硬引流（微信/私信领取/外链），不要新增营销承诺。
必须保留原意、人群语气与关键词；opening_30 字段总字数不得超过 30 字（含标点）。
只输出一个 JSON 对象，键名与输入完全一致，不要 markdown，不要解释。"""
    user = (
        f"命中类型摘要：{hit_summary}\n"
        f"请输出合规后的 JSON：\n{payload}"
    )
    raw, _ = invoke_llm_chat_messages_deepseek_only(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.2,
        timeout_sec=90,
    )
    t = raw.strip()
    i, j = t.find("{"), t.rfind("}")
    if i < 0 or j <= i:
        raise ValueError("compliance_llm_no_json")
    data = json.loads(t[i : j + 1])
    if not isinstance(data, dict):
        raise ValueError("compliance_llm_bad_json")
    merged = dict(fields)
    for k in fields:
        if k in data and data[k] is not None:
            merged[k] = str(data[k]).strip()
    return merged


def _apply_safe_fallbacks(fields: dict[str, str]) -> dict[str, str]:
    out = dict(fields)
    scan = scan_xhs_fields(out)
    if scan.passed:
        return out
    if scan.severity == "heavy" and "drainage" in scan.categories:
        inter = out.get("interaction", "").strip()
        if inter:
            out["interaction"] = _SAFE_CTA_INTERACT
    for k in list(out.keys()):
        if k.startswith("tag_"):
            t = out[k]
            if scan_text(t, k):
                out[k] = ""
    # 去掉空 tag 后由上层补标签
    body = out.get("body", "")
    if scan_text(body, "body"):
        out["body"] = rule_soften_text(body)[0] or body
    return out


def apply_compliance_to_xhs_fields(
    fields: dict[str, str],
    *,
    max_llm_passes: int = 1,
) -> tuple[dict[str, str], dict[str, Any]]:
    """
    对小红书各文本字段预检并自动软化，只返回终稿字段 + compliance 元数据。
    fields 键示例：title_0, opening_30, body, interaction, tag_0, cover_0
    """
    current = dict(fields)
    soften_passes = 0
    total_rule = 0

    scan = scan_xhs_fields(current)
    if scan.passed:
        return current, _compliance_meta(scan, soften_passes=0, rule_count=0)

    current, total_rule = rule_soften_xhs_fields(current)
    scan = scan_xhs_fields(current)
    if scan.passed:
        return current, _compliance_meta(scan, soften_passes=0, rule_count=total_rule, status="auto_softened")

    llm_attempts = 0
    while not scan.passed and llm_attempts < max_llm_passes and scan.severity in ("medium", "heavy"):
        try:
            current = _llm_soften_xhs_json(current, scan)
            soften_passes += 1
            llm_attempts += 1
        except Exception as exc:
            logger.warning("compliance llm soften failed: %s", exc)
            break
        scan = scan_xhs_fields(current)

    if not scan.passed:
        current = _apply_safe_fallbacks(current)
        current, extra_rule = rule_soften_xhs_fields(current)
        total_rule += extra_rule
        scan = scan_xhs_fields(current)

    if not scan.passed:
        raise RuntimeError("compliance_failed")

    status = "passed" if total_rule == 0 and soften_passes == 0 else "auto_softened"
    return current, _compliance_meta(scan, soften_passes=soften_passes, rule_count=total_rule, status=status)


def apply_compliance_to_mp_fields(
    fields: dict[str, str],
    *,
    max_llm_passes: int = 1,
) -> tuple[dict[str, str], dict[str, Any]]:
    """公众号标题/摘要/正文/cta 同样走规则 + 可选 LLM。"""
    return apply_compliance_to_xhs_fields(fields, max_llm_passes=max_llm_passes)


def _compliance_meta(
    scan: ComplianceScanResult,
    *,
    soften_passes: int,
    rule_count: int,
    status: str | None = None,
) -> dict[str, Any]:
    hit_count = len(scan.hits)
    st = status or ("passed" if hit_count == 0 else "auto_softened")
    if st == "passed":
        msg = "合规检查通过，可直接复制发布"
    else:
        msg = f"已自动合规优化 {max(hit_count, rule_count)} 处，可直接复制发布"
    return {
        "status": st,
        "hit_count": hit_count,
        "categories": scan.categories,
        "soften_passes": soften_passes,
        "rule_replacements": rule_count,
        "user_message": msg,
    }


def xhs_fields_from_pack(
    *,
    titles: list[str],
    opening_30: str,
    body: str,
    interaction: str,
    tags: list[str],
    cover_suggestions: list[str],
) -> dict[str, str]:
    fields: dict[str, str] = {
        "opening_30": opening_30,
        "body": body,
        "interaction": interaction,
    }
    for i, t in enumerate(titles[:5]):
        fields[f"title_{i}"] = t
    for i, tag in enumerate(tags[:8]):
        fields[f"tag_{i}"] = tag
    for i, c in enumerate(cover_suggestions[:3]):
        fields[f"cover_{i}"] = c
    return fields


def xhs_pack_from_compliant_fields(
    fields: dict[str, str],
    *,
    compliance: dict[str, Any],
    theme: str = "",
    trace_id: Any = None,
    platform: str = "xiaohongshu",
) -> dict[str, Any]:
    titles = [fields[k] for k in sorted(fields) if k.startswith("title_") and fields[k].strip()]
    tags = [fields[k] for k in sorted(fields) if k.startswith("tag_") and fields[k].strip()]
    covers = [fields[k] for k in sorted(fields) if k.startswith("cover_") and fields[k].strip()]
    opening = str(fields.get("opening_30") or "").strip()
    body_main = str(fields.get("body") or "").strip()
    interaction = str(fields.get("interaction") or "").strip()

    body_parts = [p for p in [opening, body_main] if p]
    full_body = "\n\n".join(body_parts)
    if tags:
        tag_line = format_hashtag_line(tags[:8])
        if tag_line:
            full_body = f"{full_body}\n\n{tag_line}".strip() if full_body else tag_line
    if interaction:
        full_body = f"{full_body}\n\n{interaction}".strip() if full_body else interaction

    titles_out = titles[:3] if titles else ["笔记标题"]
    while len(titles_out) < 3:
        titles_out.append(titles_out[0] if titles_out else "笔记标题备选")

    pack: dict[str, Any] = {
        "platform": "wechat_mp" if platform == "wechat_mp" else "xiaohongshu",
        "titles": titles_out[:3],
        "cover_hook": titles_out[0] if titles_out else "",
        "opening_30": opening[:30],
        "theme": theme[:500],
        "body": full_body[:8000],
        "tags": tags[:8],
        "interaction": interaction[:300],
        "imageSuggestions": covers[:4],
        "coverSuggestions": covers[:4],
        "compliance": compliance,
    }
    if trace_id is not None:
        pack["trace_id"] = trace_id
    return pack

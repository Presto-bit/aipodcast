"""Studio domain → 成稿 prompt  overlay（expert 暂统一 xhs_ops，按 domain 调体裁）。"""
from __future__ import annotations

from typing import Any

EXPERT_BY_DOMAIN: dict[str, str] = {
    "social": "xhs_ops",
    "article": "xhs_ops",
    "business": "xhs_ops",
    "narrative": "xhs_ops",
    "script": "xhs_ops",
    "academic": "xhs_ops",
    "general": "xhs_ops",
}

DOMAIN_WRITER_PREAMBLE: dict[str, str] = {
    "social": "体裁：社交短文；可用标题、正文、话题与封面简述。",
    "article": "体裁：科普/专栏长文；结构清晰、分段充分，不要种草清单体，不要社交话题标签，不要强钩子开场套路。",
    "business": "体裁：商务邮件或对外文案；正式、简洁，无话题标签与种草结构。",
    "narrative": "体裁：叙事/故事；注重情节，非清单体。",
    "script": "体裁：口播/播客/视频脚本；口语化、分节清晰，不要 hashtags。",
    "academic": "体裁：学术摘要/综述；客观严谨，无营销口吻。",
    "general": "体裁：通用文稿；按任务判断结构。",
}


def compose_writer_preamble(domain: str, fmt: str = "general") -> str:
    d = str(domain or "general").strip().lower()
    base = DOMAIN_WRITER_PREAMBLE.get(d, DOMAIN_WRITER_PREAMBLE["general"])
    f = str(fmt or "general").strip().lower()
    if f and f != "general":
        base = f"{base} 格式：{f}。"
    return base


DOMAIN_OVERLAY: dict[str, str] = {
    "social": "体裁：社交短文（如小红书笔记）；可有标题、正文、话题标签与封面简述。",
    "article": "体裁：科普/专栏长文；结构清晰，少用社交话题标签，正文为主。",
    "business": "体裁：商务邮件或对外文案；正式、简洁，无种草话题标签。",
    "narrative": "体裁：叙事/故事；注重情节与人物，非清单体。",
    "script": "体裁：口播/播客/视频脚本；口语化、分节清晰。",
    "academic": "体裁：学术摘要/综述；客观、引用友好，避免营销口吻。",
    "general": "体裁：通用文稿；按任务句判断结构，避免无关模板骨架。",
}


def expert_id_for_payload(payload: dict[str, Any]) -> str:
    domain = str(payload.get("domain") or "general").strip().lower()
    return EXPERT_BY_DOMAIN.get(domain, "xhs_ops")


def domain_author_overlay(payload: dict[str, Any]) -> str:
    domain = str(payload.get("domain") or "general").strip().lower()
    fmt = str(payload.get("format") or "general").strip().lower()
    base = DOMAIN_OVERLAY.get(domain, DOMAIN_OVERLAY["general"])
    if fmt and fmt != "general":
        base = f"{base} 格式偏好：{fmt}。"
    return base


def apply_domain_compose_intake(
    intake: dict[str, Any],
    *,
    domain: str,
    fmt: str,
    task_sentence: str,
) -> dict[str, Any]:
    """Planner domain/format → intake 篇幅与结构偏好（成稿前调用）。"""
    from .studio_planner_utils import target_chars_for_domain

    merged = dict(intake or {})
    d = str(domain or "general").strip().lower()
    f = str(fmt or "general").strip().lower()
    target = target_chars_for_domain(d, f, task_sentence)
    merged["_domainTargetChars"] = target
    if d in ("article", "academic") or f in ("long_form", "tutorial", "summary"):
        merged["length"] = "long"
        merged["withHashtags"] = "no"
        merged.setdefault("noteType", "howto")
    elif d == "business" or f == "email":
        merged["withHashtags"] = "no"
        merged.setdefault("tone", "formal")
    elif d == "social" or f == "short_post":
        merged.setdefault("length", "medium")
    return merged

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

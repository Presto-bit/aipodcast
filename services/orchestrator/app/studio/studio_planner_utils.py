"""Studio Planner 共享：写稿意图、domain 推断、篇幅档位。"""
from __future__ import annotations

import re
from typing import Any

from .agent_route import TOPIC_FORM_SIGNAL, WRITE_INTENT

NEW_DRAFT_SIGNAL = re.compile(
    r"另写|新稿|换主题|重新开|另一篇|再来一篇|写另一|换个主题|另起"
)
EXPLICIT_COMPOSE_SIGNAL = re.compile(
    r"写.*(?:篇|科普|文章|长文|稿)|成稿|创作一篇|帮我写|我想写|编写|约?\s*\d{3,4}\s*字"
)

_VALID_DOMAINS = frozenset(
    {"social", "article", "business", "narrative", "script", "academic", "general"}
)
_VALID_FORMATS = frozenset(
    {
        "short_post",
        "long_form",
        "listicle",
        "email",
        "tutorial",
        "script_beats",
        "summary",
        "general",
    }
)

_DOMAIN_SIGNALS: list[tuple[str, str, re.Pattern[str]]] = [
    ("social", "short_post", re.compile(r"小红书|种草|笔记|话题|清单体|社交|帖子")),
    ("article", "long_form", re.compile(r"科普|专栏|长文|深度|1500|2000\s*字|2000字")),
    ("business", "email", re.compile(r"邮件|客户|提案|复盘|商务|正式|对外")),
    ("narrative", "general", re.compile(r"故事|随笔|叙事|小说|经历")),
    ("script", "script_beats", re.compile(r"播客|口播|脚本|视频稿|分镜")),
    ("academic", "summary", re.compile(r"摘要|文献|综述|论文|学术")),
]


def is_new_draft_intent(message: str) -> bool:
    return bool(NEW_DRAFT_SIGNAL.search(str(message or "").strip()))


def has_compose_write_intent(message: str, task_sentence: str = "") -> bool:
    text = f"{message} {task_sentence}".strip()
    if not text:
        return False
    if WRITE_INTENT.search(text):
        return True
    if EXPLICIT_COMPOSE_SIGNAL.search(text):
        return True
    if TOPIC_FORM_SIGNAL.search(text) and re.search(r"\d{3,4}\s*字|科普|长文", text):
        return True
    return False


def assumptions_imply_new_draft(assumptions: list[str] | tuple[str, ...] | None) -> bool:
    if not assumptions:
        return False
    joined = " ".join(str(a) for a in assumptions)
    return bool(re.search(r"新稿|另写|换主题|另起", joined))


def assumptions_imply_local_revise(assumptions: list[str] | tuple[str, ...] | None) -> bool:
    if not assumptions:
        return False
    joined = " ".join(str(a) for a in assumptions)
    return bool(re.search(r"只改|局部|标题|语气|润色|缩短|加长", joined))


def normalize_planner_domain(raw: str) -> str:
    d = str(raw or "").strip().lower()
    return d if d in _VALID_DOMAINS else ""


def normalize_planner_format(raw: str) -> str:
    f = str(raw or "").strip().lower()
    return f if f in _VALID_FORMATS else ""


def infer_domain_format_from_text(text: str) -> tuple[str, str]:
    q = str(text or "").strip()
    if not q:
        return "general", "general"
    for domain, fmt, pat in _DOMAIN_SIGNALS:
        if pat.search(q):
            return domain, fmt
    if re.search(r"清单|列表|几条", q):
        return "article", "listicle"
    if re.search(r"写篇|写一篇|成稿|创作", q):
        return "general", "general"
    return "general", "general"


def merge_planner_domain_format(
    *,
    llm_domain: str,
    llm_format: str,
    hint_domain: str,
    hint_format: str,
    task_sentence: str,
    message: str,
) -> tuple[str, str]:
    domain = normalize_planner_domain(llm_domain) or normalize_planner_domain(hint_domain)
    fmt = normalize_planner_format(llm_format) or normalize_planner_format(hint_format)
    if not domain or domain == "general":
        inferred_d, inferred_f = infer_domain_format_from_text(f"{task_sentence}\n{message}")
        if inferred_d != "general":
            domain = inferred_d
            if fmt == "general" and inferred_f != "general":
                fmt = inferred_f
    if not domain:
        domain = "general"
    if not fmt:
        fmt = "general"
    return domain, fmt


def target_chars_for_domain(domain: str, fmt: str, task_sentence: str) -> int:
    text = str(task_sentence or "")
    m = re.search(r"(?:写|约|到|至少)\s*(\d{3,4})\s*字", text)
    if m:
        n = int(m.group(1))
        return min(max(n, 400), 3200)
    d = normalize_planner_domain(domain) or "general"
    f = normalize_planner_format(fmt) or "general"
    if d in ("article", "academic") or f in ("long_form", "tutorial"):
        return 2000
    if d == "social" or f == "short_post":
        return 600
    if f == "listicle":
        return 900
    return 900


def explicit_goal_from_payload(payload: dict[str, Any]) -> str:
    return str(payload.get("explicitGoal") or payload.get("explicit_goal") or "").strip().lower()


def apply_explicit_goal_tool(tool: str, explicit_goal: str) -> str:
    g = explicit_goal.strip().lower()
    if g == "ask":
        return "reply"
    if g == "compose":
        return "compose"
    if g == "revise":
        return "revise"
    return tool

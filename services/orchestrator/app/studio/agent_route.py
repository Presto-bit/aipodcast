"""Studio V2 — Agent 路由（门禁已删除，open-ended 默认 compose）。"""
from __future__ import annotations

import re
from typing import Any, Literal

StudioTool = Literal["reply", "compose", "revise", "patch", "read_manuscript", "search_corpus"]

STUDIO_NEEDS_BRIEF = "NEEDS_BRIEF"
STUDIO_NEEDS_REWRITE = "NEEDS_REWRITE"


def compose_soft_failure_code(task_sentence: str) -> str:
    """V2：不再因 brief 不足 blocking，统一走 rewrite/重试。"""
    _ = task_sentence
    return STUDIO_NEEDS_REWRITE


TOPIC_FORM_SIGNAL = re.compile(
    r"清单|笔记|教程|测评|好物|干货|故事|攻略|标题|正文|受众|新人|职场|产品|运营|清单体|种草|周报|总结|邮件|科普|脚本|播客"
)
REVISE_SIGNAL = re.compile(
    r"改版|改一下|改标题|改正文|缩短|加长|重写|重新写|更犀利|别动正文|只改|润色|优化"
)
LENGTH_CONSTRAINT_SIGNAL = re.compile(
    r"写\s*\d+\s*字|约?\s*\d+\s*字|到\s*\d+\s*字|字数|篇幅|扩写|写长|写短|太短|太长|精简|压缩|扩充"
)
BLOCK_PATCH_SIGNAL = re.compile(r"【块级改版】|块级改版")
MANUSCRIPT_READ_SIGNAL = re.compile(
    r"总结|概括|要点|解读|分析|看看|讲讲|什么意思|怎么样|评价|点评|优缺点|说了什么|讲了什么"
)
EDIT_SIGNAL = re.compile(
    r"改版|改一下|改标题|改正文|缩短|加长|重写|重新写|更犀利|别动正文|只改|润色|优化|"
    r"写\s*\d+\s*字|约?\s*\d+\s*字|到\s*\d+\s*字|字数|篇幅|扩写|写长|写短|【块级改版】|块级改版"
)
WRITE_INTENT = re.compile(
    r"生成|成稿|创作一篇|写一篇|开始写|帮我写|帮我做一篇|我想创作|我想写|编写|推广文案|小红书"
)
ASK_SIGNAL = re.compile(r"[?？]$|怎么(写|改|搭)|如何(写|改)|钩子|开头|结构|^(帮我)?(分析|解读|看看|讲讲)")
COMPOSE_CHIP_SIGNAL = re.compile(
    r"^(按已有信息|再试一次|直接开始写成稿|(受众|卖点|场景|主题)[：:])"
)


def _needs_promo_clarify(_text: str) -> bool:
    return False


def is_insufficient_brief(_message: str) -> bool:
    """V2：门禁删除 — 永远不因 brief 不足阻断。"""
    return False


def is_explicit_ask_while_ready(message: str) -> bool:
    q = message.strip()
    if not q:
        return False
    if not ASK_SIGNAL.search(q) and not q.endswith("?") and not q.endswith("？"):
        return False
    return bool(re.search(r"怎么|如何|为什么|为啥|是否|能不能|可以吗", q))


def is_manuscript_read_intent(message: str) -> bool:
    q = message.strip()
    if not q:
        return False
    if EDIT_SIGNAL.search(q):
        return False
    return bool(MANUSCRIPT_READ_SIGNAL.search(q) or ASK_SIGNAL.search(q))


def is_manuscript_edit(message: str, *, has_manuscript: bool) -> bool:
    q = message.strip()
    if not has_manuscript or not q:
        return False
    if is_explicit_ask_while_ready(q) or is_manuscript_read_intent(q):
        return False
    if EDIT_SIGNAL.search(q):
        return True
    if REVISE_SIGNAL.search(q) or LENGTH_CONSTRAINT_SIGNAL.search(q) or BLOCK_PATCH_SIGNAL.search(q):
        return True
    if len(q) <= 56 and not q.endswith("?") and not q.endswith("？"):
        return True
    return False


def is_ask_only(message: str, *, has_manuscript: bool) -> bool:
    q = message.strip()
    if has_manuscript and is_manuscript_edit(q, has_manuscript=True):
        return False
    if WRITE_INTENT.search(q):
        return False
    if has_manuscript and ASK_SIGNAL.search(q):
        return True
    if not has_manuscript and ASK_SIGNAL.search(q):
        return True
    if re.search(r"运营|策略|涨粉|流量|算法", q) and not WRITE_INTENT.search(q):
        return True
    return False


def should_force_compose(
    *,
    message: str,
    task_sentence: str,
    version_count: int,
    force_compose: bool = False,
) -> bool:
    if version_count > 0:
        return False
    if force_compose:
        return True
    return bool(COMPOSE_CHIP_SIGNAL.search(message.strip()))


def route_studio_agent(
    *,
    message: str,
    status: str,
    version_count: int,
    task_sentence: str,
    agent_mode: str = "write",
    force_compose: bool = False,
    has_pending_patch: bool = False,
) -> StudioTool:
    from .agent_action import action_to_legacy_tool, resolve_studio_action

    action = resolve_studio_action(
        message=message,
        status=status,
        version_count=version_count,
        task_sentence=task_sentence,
        agent_mode=agent_mode,
        force_compose=force_compose,
        has_pending_patch=has_pending_patch,
    )
    return action_to_legacy_tool(action)


def should_compose_without_manuscript(
    *,
    message: str,
    task_sentence: str,
    version_count: int,
    status: str = "draft",
) -> bool:
    from .agent_action import should_create_without_manuscript

    return should_create_without_manuscript(
        message=message,
        task_sentence=task_sentence,
        version_count=version_count,
        status=status,
    )


def reply_for_blocking(_message: str) -> str:
    return ""


def build_task_sentence_from_turns(turns: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for t in turns:
        if str(t.get("role") or "") != "user":
            continue
        text = str(t.get("content") or "").strip()
        if text:
            parts.append(text)
    return "\n\n".join(parts)[:2000]


def refine_compose_task_sentence(text: str) -> str:
    """纠错与合并碎片 brief，避免用户输入小错误阻断成稿。"""
    s = str(text or "").strip()
    if not s:
        return ""
    s = re.sub(r"[\u200b-\u200d\ufeff]", "", s)
    for old, new in (
        ("小红树", "小红书"),
        ("小虹书", "小红书"),
        ("保温杯杯", "保温杯"),
    ):
        s = s.replace(old, new)
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in s.split("\n") if ln.strip()]
    if len(lines) > 1 and all(len(ln) <= 36 and not re.search(r"[。！？.!?]$", ln) for ln in lines):
        s = "，".join(lines)
    else:
        s = "\n\n".join(lines)
    return s[:2000]


def build_compose_task_sentence(
    turns: list[dict[str, Any]],
    *,
    current_message: str = "",
) -> str:
    """成稿任务句：剔除纯问答轮次，避免「怎么写钩子」污染推广成稿。"""
    parts: list[str] = []
    for t in turns:
        if str(t.get("role") or "") != "user":
            continue
        text = str(t.get("content") or "").strip()
        if text and not is_ask_only(text, has_manuscript=False):
            parts.append(text)
    cur = current_message.strip()
    if cur and not is_ask_only(cur, has_manuscript=False):
        if not parts or parts[-1] != cur:
            parts.append(cur)
    if parts:
        return refine_compose_task_sentence("\n\n".join(parts))
    if cur:
        return refine_compose_task_sentence(cur)
    return refine_compose_task_sentence(build_task_sentence_from_turns(turns))

"""Studio Agent 路由（与前端 studioOrchestrator 对齐，服务端复验）。"""
from __future__ import annotations

import re
from typing import Any, Literal

StudioTool = Literal["reply", "compose", "revise"]

TOPIC_FORM_SIGNAL = re.compile(
    r"清单|小红书|笔记|教程|测评|好物|干货|故事|攻略|标题|正文|受众|新人|职场|产品|运营|清单体|种草|周报|总结"
)
PROMO_DETAIL_SIGNAL = re.compile(
    r"受众|人群|读者|卖点|场景|功能|材质|主打|痛点|提醒|便携|保温|职场|新人|白领|品牌|价格|差异化|清单体|教程|测评|故事"
)
REVISE_SIGNAL = re.compile(r"改版|改一下|改标题|改正文|缩短|加长|重写|重新写|更犀利|别动正文|只改|润色|优化")
BLOCK_PATCH_SIGNAL = re.compile(r"【块级改版】|块级改版")
WRITE_INTENT = re.compile(r"生成|成稿|创作一篇|写一篇|开始写|帮我写|帮我做一篇|我想创作")
ASK_SIGNAL = re.compile(r"[?？]$|怎么(写|改|搭)|如何(写|改)|钩子|开头|结构|^(帮我)?(分析|解读|看看|讲讲)")


def _needs_promo_clarify(text: str) -> bool:
    is_promo = bool(re.search(r"推广|种草|带货", text)) or (
        re.search(r"水杯|杯子|保温杯|产品|新品", text) and re.search(r"小红书|笔记|写篇|写一篇", text)
    )
    if not is_promo:
        return False
    return not PROMO_DETAIL_SIGNAL.search(text)


def is_insufficient_brief(message: str) -> bool:
    text = message.strip()
    if not text or len(text) < 8:
        return True
    if _needs_promo_clarify(text):
        return True
    has_write = bool(WRITE_INTENT.search(text))
    has_topic = bool(TOPIC_FORM_SIGNAL.search(text))
    if has_write and has_topic:
        return False
    if has_write and len(text) >= 14:
        return False
    if has_topic and len(text) >= 12:
        return False
    if re.match(r"^(帮我想|写点|想做|来点|整点|搞个|随便)", text) and not has_topic:
        return True
    return len(text) < 14 and not has_topic and not has_write


def is_ask_only(message: str, *, has_manuscript: bool) -> bool:
    q = message.strip()
    if WRITE_INTENT.search(q):
        return False
    if has_manuscript and ASK_SIGNAL.search(q):
        return True
    if not has_manuscript and ASK_SIGNAL.search(q):
        return True
    if re.search(r"运营|策略|涨粉|流量|算法", q) and not WRITE_INTENT.search(q):
        return True
    return False


def route_studio_agent(
    *,
    message: str,
    status: str,
    version_count: int,
    task_sentence: str,
) -> StudioTool:
    q = message.strip()
    has_ms = version_count > 0
    if status == "generating":
        return "reply"
    if has_ms and status in ("ready", "shipped") and (
        REVISE_SIGNAL.search(q) or BLOCK_PATCH_SIGNAL.search(q)
    ):
        return "revise"
    draft_like = status in ("draft", "briefing", "planned")
    if draft_like and task_sentence.strip() and version_count == 0:
        if not is_ask_only(q, has_manuscript=False) and not is_insufficient_brief(q):
            return "compose"
    return "reply"


def reply_for_blocking(message: str) -> str:
    if _needs_promo_clarify(message):
        return (
            "要写清这篇笔记，还需要补充：受众、产品卖点、使用场景。"
            "例如：「给上班族，主打 6 小时保温，办公室场景」"
        )
    return "可以先说说想写什么主题、给谁看、用什么形式（如清单体/教程）吗？"


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

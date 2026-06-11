"""新用户示例笔记本：降低首次上传与提问门槛。"""

from __future__ import annotations

import logging
from typing import Any

from .models import (
    aggregate_notebook_input_stats,
    create_notebook_only,
    create_text_note,
    ensure_default_project,
    merge_user_preferences_for_phone,
)

logger = logging.getLogger(__name__)

ONBOARDING_NOTEBOOK_NAME = "快速上手"

_STARTER_NOTES: tuple[tuple[str, str], ...] = (
    (
        "Presto 能帮你做什么",
        """Presto 以你的资料为根基，生成可分发内容：

- 向资料提问：回答附带可点击的来源引用，减轻 AI 幻觉顾虑
- 生成播客：多角色配音，成品进入「作品」页收听与导出
- 生成文章 / 自媒体稿：同一批资料可分支为长文、小红书等平台内容

建议：勾选左侧资料后，在底部输入问题，或点击「生成播客」。长任务无需一直等待，完成后可在「作品」查看。""",
    ),
    (
        "三步上手",
        """① 资料：整理电子书、网页、文档等素材（本笔记本已含示例，可直接勾选）

② 创作：侧栏「播客工作室」或笔记本内「生成播客 / 生成文章」

③ 作品：收听、下载、分享或发布 RSS

提示：可在笔记本内提炼「写作风格」，后续生成会更贴近你的表达方式。""",
    ),
)


def _total_note_count(stats: dict[str, dict[str, Any]]) -> int:
    total = 0
    for row in stats.values():
        try:
            total += int(row.get("note_count") or 0)
        except (TypeError, ValueError):
            continue
    return total


def create_onboarding_starter_notebook(user_ref: str | None) -> dict[str, Any]:
    """
    幂等创建「快速上手」示例笔记本与两条文本资料。
    若用户已有任意资料且尚无该笔记本，则跳过（避免干扰老用户空库误触）。
    """
    ref = (user_ref or "").strip()
    if not ref:
        return {"ok": False, "error": "未登录"}

    stats = aggregate_notebook_input_stats(ref)
    existing = stats.get(ONBOARDING_NOTEBOOK_NAME) or {}
    if int(existing.get("note_count") or 0) > 0:
        return {
            "ok": True,
            "notebook": ONBOARDING_NOTEBOOK_NAME,
            "created": False,
            "noteIds": [],
            "reason": "already_exists",
        }

    total = _total_note_count(stats)
    if total > 0:
        return {
            "ok": False,
            "error": "你已有资料，可直接新建笔记本或向现有资料提问",
            "reason": "has_notes",
        }

    ok, msg = create_notebook_only(ONBOARDING_NOTEBOOK_NAME, user_ref=ref)
    if not ok and msg != "该名称已存在":
        return {"ok": False, "error": msg or "创建笔记本失败"}

    project_id = ensure_default_project(ONBOARDING_NOTEBOOK_NAME, created_by=ref)
    note_ids: list[str] = []
    try:
        for title, content in _STARTER_NOTES:
            note_id = create_text_note(
                project_id=project_id,
                title=title,
                notebook=ONBOARDING_NOTEBOOK_NAME,
                content=content,
                user_ref=ref,
                extra_metadata={"onboardingStarter": True},
            )
            note_ids.append(note_id)
    except Exception:
        logger.exception("create_onboarding_starter_notebook: create_text_note failed")
        return {"ok": False, "error": "写入示例资料失败，请稍后重试"}

    try:
        merge_user_preferences_for_phone(ref, {"onboarding_starter_created_v1": True})
    except Exception:
        pass

    return {
        "ok": True,
        "notebook": ONBOARDING_NOTEBOOK_NAME,
        "created": True,
        "noteIds": note_ids,
    }

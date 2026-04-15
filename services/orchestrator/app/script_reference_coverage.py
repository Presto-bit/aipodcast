"""
多笔记参考时的脚本约束注入。

- 长文（article）：强调单主线、论证链、过渡与递进，避免「一书一节」机械并列（此前仅强调「逐条对应」易诱发各说各话）。
- 播客：强调统一话题与覆盖全部资料。

可通过环境变量 SCRIPT_MULTI_NOTE_COVERAGE_DISABLE=1 关闭自动追加约束。
"""
from __future__ import annotations

import os
from typing import Any


def count_selected_notes(payload: dict[str, Any]) -> int:
    """payload.selected_note_ids 中有效条数。"""
    sn = payload.get("selected_note_ids")
    if not isinstance(sn, list):
        return 0
    return len([str(x).strip() for x in sn if isinstance(x, str) and str(x).strip()])


def article_outline_min_chars_threshold(selected_note_count: int) -> int:
    """
    长文先出提纲的最低目标字数门槛。
    多笔记时降低门槛，使「先大纲再分段」更常生效（仍可用环境变量覆盖）。
    """
    try:
        base = int(os.getenv("ARTICLE_OUTLINE_MIN_CHARS", "4000") or "4000")
    except (TypeError, ValueError):
        base = 4000
    if selected_note_count >= 3:
        try:
            low = int(os.getenv("ARTICLE_OUTLINE_MULTI_NOTE_MIN_CHARS", "2000") or "2000")
        except (TypeError, ValueError):
            low = 2000
        return min(base, max(800, low))
    return base


def _output_mode_article(payload: dict[str, Any], script_opts: dict[str, Any]) -> bool:
    om = str(script_opts.get("output_mode") or payload.get("output_mode") or "").strip().lower()
    return om == "article"


def augment_script_options_for_multi_note_coverage(
    payload: dict[str, Any],
    script_opts: dict[str, Any],
) -> dict[str, Any]:
    """
    在 script_constraints 末尾追加说明（≥2 条笔记时）。
    - 文章（article）：强调「单主线整合」+ 覆盖全部资料，避免「一书一节」机械并列。
    - 播客/对话：强调覆盖 + 统一话题主线，避免轮流各说各书。
    """
    if (os.getenv("SCRIPT_MULTI_NOTE_COVERAGE_DISABLE", "") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    ):
        return script_opts

    n = count_selected_notes(payload)
    if n < 2:
        return script_opts

    out = dict(script_opts)
    base = str(out.get("script_constraints") or "").strip()
    is_article = _output_mode_article(payload, script_opts)

    if is_article:
        # 长文：优先整合逻辑，避免先前「逐条对应」诱发分块堆砌
        if n >= 8:
            block = (
                "\n\n【多资料整合写作】本次已勾选较多条资料（≥8）。"
                "必须围绕**一条清晰的主线问题或中心论点**组织全篇，将各来源作为论据、案例、对比或反例**编入同一论证链条**，"
                "禁止写成「资料一/书一、书二」式机械并列或各书各写一段却互不衔接。"
                "章节之间须有承上启下的过渡；允许小标题，但结构须有总分、递进、因果或对照关系。"
                "同时须**覆盖所选全部资料**：不得长期只引用少数几本；弱相关来源可点明其在整体论证中的位置。"
                f"\n【来源数量锁定】用户本次在知识库勾选笔记共 **{n}** 条。若正文出现「综合 N 条资料」「基于 N 本书」「共 N 本」等表述，**N 必须等于 {n}**；"
                "不得根据检索片段里实际出现的「来源」编号种类数自行改写为 N−1 或其他数字（检索可能未均匀展示每一条，但勾选条数以本句为准）。"
                "体裁为书面长文，禁止「感谢收听」「感谢你的收听」「我们下次再见」等播客/节目结语；中途分段禁止写告别语。"
            )
        else:
            block = (
                "\n\n【多资料整合写作】本次已勾选多条笔记作为参考。"
                "须用**一个中心议题**串联不同材料，通过过渡句、小结与对照把各来源观点勾连成文，避免各段只讲一本书、段与段之间无逻辑关联。"
                "同时须覆盖所选全部资料（可点名书名或序号），避免只展开少数几本；弱相关条目可简要说明其定位。"
                f"\n【来源数量锁定】用户本次勾选笔记共 **{n}** 条；若正文写及资料条数或「N 本」，**N 须为 {n}**，勿与检索片段出现次数混淆。"
                "体裁为书面长文，禁止播客式结语（如「感谢收听」「我们下次再见」）；非全文末段禁止告别套话。"
            )
    else:
        if n >= 8:
            block = (
                "\n\n【多资料覆盖】本次已勾选较多条资料（≥8）。"
                "对话/独白须有**统一话题主线**，避免轮流介绍各书却无交锋、对比或收束；"
                "须安排结构使各来源在正文中均有对应（可用过渡或点名），禁止只集中少数几本。"
                "若某条与主题弱相关，可简要说明其定位，避免完全忽略。"
            )
        else:
            block = (
                "\n\n【多资料覆盖】本次已勾选多条笔记作为参考。"
                "成稿须覆盖所选全部资料：对每一条来源在整体叙事中至少有机出现一次（可点名书名或材料序号），"
                "避免只围绕少数几本展开；须保持话题连贯，避免各说各话。"
                "若某条与主题弱相关，可简要说明其定位或一笔带过。"
            )

    out["script_constraints"] = (base + block).strip()
    return out

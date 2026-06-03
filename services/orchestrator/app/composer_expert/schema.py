"""ExpertDeliverable JSON 校验（与前端 validateExpertDeliverable 对齐）。"""
from __future__ import annotations

from typing import Any

EXPERT_IDS = frozenset({"xhs_ops", "mp_ops", "voice_gen", "podcast_plan"})
COVERAGE = frozenset({"full", "partial", "none"})
OPS_TIERS = frozenset({"must_do", "nice_to_have", "after_publish"})


def validate_expert_deliverable(raw: Any, *, expert_id: str | None = None) -> list[str]:
    errors: list[str] = []
    if not isinstance(raw, dict):
        return ["根节点须为对象"]

    eid = str(raw.get("expertId") or expert_id or "").strip()
    if eid not in EXPERT_IDS:
        errors.append("expertId 无效")
        return errors

    content = raw.get("content")
    if eid == "xhs_ops":
        _validate_xhs_content(content, errors)
    elif eid == "mp_ops" and isinstance(content, dict):
        for key in ("title", "summary", "bodyMarkdown"):
            if not str(content.get(key) or "").strip():
                errors.append(f"content.{key} 须为非空字符串")

    _validate_ops(raw.get("ops"), eid, errors)
    _validate_meta(raw.get("meta"), errors)
    return errors


def _validate_xhs_content(content: Any, errors: list[str]) -> None:
    if not isinstance(content, dict):
        errors.append("content 须为对象")
        return
    titles = content.get("titles")
    if not isinstance(titles, list) or not titles:
        errors.append("content.titles 须为非空数组")
    if not str(content.get("body") or "").strip():
        errors.append("content.body 须为非空字符串")
    if not isinstance(content.get("hashtags"), list):
        errors.append("content.hashtags 须为数组")
    cover = content.get("cover")
    if not isinstance(cover, dict):
        errors.append("content.cover 须为对象")
        return
    if not str(cover.get("headline") or "").strip():
        errors.append("content.cover.headline 须为非空字符串")
    slides = cover.get("slides")
    if not isinstance(slides, list) or not slides:
        errors.append("content.cover.slides 须为非空数组")


def _validate_ops(ops: Any, expert_id: str, errors: list[str]) -> None:
    if not isinstance(ops, dict):
        errors.append("ops 须为对象")
        return
    if str(ops.get("expertId") or "") != expert_id:
        errors.append("ops.expertId 须与 expertId 一致")
    steps = ops.get("steps")
    if not isinstance(steps, list) or not steps:
        errors.append("ops.steps 须为非空数组")
        return
    for i, step in enumerate(steps):
        prefix = f"ops.steps[{i}]"
        if not isinstance(step, dict):
            errors.append(f"{prefix} 须为对象")
            continue
        if not isinstance(step.get("stepNo"), int) or int(step.get("stepNo") or 0) < 1:
            errors.append(f"{prefix}.stepNo 无效")
        for key in ("title", "objective"):
            if not str(step.get(key) or "").strip():
                errors.append(f"{prefix}.{key} 须为非空字符串")
        actions = step.get("actions")
        if not isinstance(actions, list) or not actions:
            errors.append(f"{prefix}.actions 须为非空数组")
        tier = str(step.get("tier") or "")
        if tier not in OPS_TIERS:
            errors.append(f"{prefix}.tier 无效")
        if not isinstance(step.get("defaultExpanded"), bool):
            errors.append(f"{prefix}.defaultExpanded 须为 boolean")
    recap = ops.get("recapStepNo")
    if not isinstance(recap, int) or recap < 1:
        errors.append("ops.recapStepNo 无效")


def _validate_meta(meta: Any, errors: list[str]) -> None:
    if not isinstance(meta, dict):
        errors.append("meta 须为对象")
        return
    rationale = meta.get("rationale")
    if not isinstance(rationale, list) or not rationale:
        errors.append("meta.rationale 须为非空数组")
    if not str(meta.get("expectedEffect") or "").strip():
        errors.append("meta.expectedEffect 须为非空字符串")
    if not str(meta.get("playbookVersion") or "").strip():
        errors.append("meta.playbookVersion 须为非空字符串")
    prov = meta.get("provenance")
    if not isinstance(prov, dict):
        errors.append("meta.provenance 无效")
        return
    cov = str(prov.get("corpusCoverage") or "")
    if cov not in COVERAGE:
        errors.append("meta.provenance.corpusCoverage 无效")

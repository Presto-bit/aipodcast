"""个人特色 IP：从素材蒸馏 trait、词云、场景与生命力摘要（v6：仅 LLM / features_merge）。"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# 维度顺序（UI 分组）
TRAIT_DIMENSIONS = ("立场", "结构", "语气", "修辞", "禁区", "平台")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def material_counts_for_learning(materials: list[dict[str, Any]]) -> tuple[int, int, int]:
    """返回 (经历数, 成稿数, 参与学习数)。"""
    exp = art = learned = 0
    for m in materials:
        if not material_in_style_learning(m):
            continue
        learned += 1
        mt = str(m.get("materialType") or "")
        if mt == "experience_card":
            exp += 1
        elif mt in ("published", "draft"):
            art += 1
    return exp, art, learned


def material_in_style_learning(m: dict[str, Any]) -> bool:
    if m.get("includeInStyleLearning") is False:
        return False
    mt = str(m.get("materialType") or "").strip()
    if mt in ("third_party", "reference"):
        return False
    from .author_ip_distill_inputs import material_has_distill_input

    return material_has_distill_input(m) or bool(str(m.get("title") or "").strip())


def _learning_materials(materials: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [m for m in materials if material_in_style_learning(m)]


def _trait_key(tr: dict[str, Any]) -> str:
    return f"{str(tr.get('dimension') or '').strip()}::{str(tr.get('label') or '').strip()}"


def _normalize_trait(tr: dict[str, Any]) -> dict[str, Any]:
    dim = str(tr.get("dimension") or "语气").strip()[:24] or "语气"
    if dim == "口吻":
        dim = "语气"
    label = str(tr.get("label") or "").strip()[:120]
    if not label:
        return {}
    ev = str(tr.get("evidence") or "").strip()[:200]
    default_on = tr.get("defaultOn")
    on = default_on is not False
    conf = tr.get("confidence")
    try:
        conf_f = float(conf) if conf is not None else 0.75
    except (TypeError, ValueError):
        conf_f = 0.75
    return {
        "dimension": dim,
        "label": label,
        "evidence": ev,
        "defaultOn": on,
        "confidence": max(0.0, min(1.0, conf_f)),
    }


def _merge_traits(
    existing: list[dict[str, Any]],
    discovered: list[dict[str, Any]],
    *,
    max_items: int = 18,
) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for tr in existing:
        if not isinstance(tr, dict):
            continue
        n = _normalize_trait(tr)
        if n:
            by_key[_trait_key(n)] = n
    for tr in discovered:
        n = _normalize_trait(tr)
        if not n:
            continue
        k = _trait_key(n)
        if k in by_key:
            old = by_key[k]
            if len(n.get("evidence") or "") > len(old.get("evidence") or ""):
                old["evidence"] = n["evidence"]
            if n.get("confidence", 0) > old.get("confidence", 0):
                old["confidence"] = n["confidence"]
        else:
            by_key[k] = n
    ordered = list(by_key.values())
    ordered.sort(
        key=lambda t: (
            TRAIT_DIMENSIONS.index(t["dimension"]) if t["dimension"] in TRAIT_DIMENSIONS else 99,
            -float(t.get("confidence") or 0),
            t["label"],
        )
    )
    if len(ordered) <= max_items:
        return ordered

    by_dim: dict[str, list[dict[str, Any]]] = {}
    for t in ordered:
        by_dim.setdefault(str(t.get("dimension") or "语气"), []).append(t)
    dim_order = [d for d in TRAIT_DIMENSIONS if d in by_dim] + sorted(
        k for k in by_dim if k not in TRAIT_DIMENSIONS
    )
    out: list[dict[str, Any]] = []
    while len(out) < max_items and any(by_dim.get(d) for d in dim_order):
        for d in dim_order:
            bucket = by_dim.get(d) or []
            if not bucket:
                continue
            out.append(bucket.pop(0))
            if len(out) >= max_items:
                break
    return out


def _top_contributors(materials: list[dict[str, Any]], *, limit: int = 3) -> list[str]:
    scored: list[tuple[int, str]] = []
    for m in _learning_materials(materials):
        title = str(m.get("title") or "").strip()
        if not title:
            continue
        body = str(m.get("body") or "")
        score = len(body) + (80 if str(m.get("materialType") or "") in ("published", "draft") else 20)
        scored.append((score, title))
    scored.sort(key=lambda x: (-x[0], x[1]))
    out: list[str] = []
    seen: set[str] = set()
    for _, title in scored:
        if title in seen:
            continue
        seen.add(title)
        out.append(title[:200])
        if len(out) >= limit:
            break
    return out


def _compute_recent_change(
    prev: dict[str, Any] | None,
    new_traits: list[dict[str, Any]],
    new_tags: list[str],
) -> str:
    prev_traits = prev.get("traitLabels") if isinstance(prev, dict) else None
    if not isinstance(prev_traits, list):
        prev_traits = []
    new_labels = [str(t.get("label") or "") for t in new_traits if t.get("defaultOn") is not False]
    added = [x for x in new_labels if x and x not in prev_traits]
    prev_tags = prev.get("tagCloud") if isinstance(prev, dict) else []
    if not isinstance(prev_tags, list):
        prev_tags = []
    tag_added = [t for t in new_tags if t not in prev_tags]
    parts: list[str] = []
    if added:
        parts.append(f"新增特色：{'、'.join(added[:3])}")
    if tag_added:
        parts.append(f"词云补充：{'、'.join(tag_added[:4])}")
    if not parts:
        return str(prev.get("recentChange") or "") if isinstance(prev, dict) else ""
    return "；".join(parts)[:240]


def maturity_hint(maturity: str, materials: list[dict[str, Any]], trait_count: int) -> str:
    exp, art, _ = material_counts_for_learning(materials)
    if maturity == "empty":
        return "勾选资料后提炼写作风格"
    if maturity == "sketch":
        if art < 1:
            return "可再勾选 1 篇以上资料，提炼会更准确"
        return "继续勾选资料并更新风格"
    if maturity == "sketch_plus":
        need = max(0, 3 - trait_count)
        if need > 0:
            return f"还可补充 {need} 条特色后更完备"
        return "风格接近完备"
    if maturity == "ready":
        return "风格已就绪，将用于播客、文章与自媒体"
    return "资料有更新时，建议再次更新风格"


def run_author_ip_distill(
    profile: dict[str, Any],
    materials: list[dict[str, Any]],
    *,
    one_liner: str = "",
    mode: str = "full",
    fresh_traits: bool = False,
) -> dict[str, Any]:
    """返回更新后的 profile（不持久化）。仅 LLM / P2 features_merge，无 v5 规则引擎回退。"""
    prof = dict(profile) if isinstance(profile, dict) else {}
    vitality = prof.get("vitality") if isinstance(prof.get("vitality"), dict) else {}
    prev_snapshot = {
        "traitLabels": [str(t.get("label") or "") for t in (prof.get("traits") or []) if isinstance(t, dict)],
        "tagCloud": list(vitality.get("tagCloud") or []) if isinstance(vitality.get("tagCloud"), list) else [],
        "recentChange": vitality.get("recentChange"),
    }

    exp_n, art_n, learned_n = material_counts_for_learning(materials)
    learn_mode = mode if mode in ("lite", "full") else "full"
    existing_traits: list[dict[str, Any]] = []
    if not fresh_traits:
        existing_traits = prof.get("traits") if isinstance(prof.get("traits"), list) else []

    tag_cloud: list[str] = []
    top3 = _top_contributors(materials)
    distill_source = "none"

    llm_out: dict[str, Any] | None = None
    if learn_mode == "full":
        try:
            from .note_style_features import learn_merge_features_enabled, learning_materials_with_fresh_features

            if learn_merge_features_enabled():
                feature_mats = learning_materials_with_fresh_features(materials)
                if feature_mats:
                    from .author_ip_distill_llm import distill_profile_merge_features

                    llm_out = distill_profile_merge_features(
                        feature_mats,
                        one_liner=one_liner,
                        existing_traits=existing_traits if not fresh_traits else [],
                    )
                    if llm_out:
                        distill_source = "features_merge"
        except Exception:
            llm_out = None

    if llm_out is None:
        try:
            from .author_ip_distill_llm import distill_profile_with_llm

            llm_out = distill_profile_with_llm(
                materials,
                one_liner=one_liner,
                existing_traits=existing_traits if not fresh_traits else [],
                mode=learn_mode,
            )
        except Exception:
            llm_out = None

    if llm_out:
        distill_source = "features_merge" if distill_source == "features_merge" else "llm"
        if llm_out.get("tagCloud"):
            tag_cloud = list(llm_out["tagCloud"])

    if learn_mode == "full":
        if llm_out and llm_out.get("traits"):
            merged = _merge_traits(existing_traits, list(llm_out["traits"]), max_items=18)
            if merged:
                prof["traits"] = merged
        elif fresh_traits:
            prof["traits"] = []

        if llm_out and llm_out.get("domains"):
            prof["domains"] = list(llm_out["domains"])

    vitality = dict(vitality)
    vitality["lastLearnedAt"] = _now_iso()
    vitality["learnMode"] = learn_mode
    vitality["distillSource"] = distill_source
    vitality["materialSummary"] = {
        "experienceCount": exp_n,
        "articleCount": art_n,
        "learningCount": learned_n,
    }
    if tag_cloud:
        vitality["tagCloud"] = tag_cloud
    if top3:
        vitality["topContributors"] = top3

    llm_change = str((llm_out or {}).get("recentChange") or "").strip()
    if llm_change:
        vitality["recentChange"] = llm_change[:240]
    else:
        vitality["recentChange"] = _compute_recent_change(
            prev_snapshot,
            prof.get("traits") if learn_mode == "full" else existing_traits,
            tag_cloud,
        )

    prof["vitality"] = vitality
    return prof

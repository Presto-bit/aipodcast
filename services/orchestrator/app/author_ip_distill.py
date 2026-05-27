"""个人特色 IP：从素材蒸馏 trait、词云、场景与生命力摘要。"""
from __future__ import annotations

import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any

# 维度顺序（UI 分组）
TRAIT_DIMENSIONS = ("立场", "结构", "语气", "修辞", "禁区", "平台")

_STOP = frozenset(
    {
        "一篇",
        "如何",
        "怎么",
        "是否",
        "值得",
        "关于",
        "我们",
        "你们",
        "可以",
        "这个",
        "那个",
        "进行",
        "通过",
        "以及",
        "如果",
        "但是",
        "因为",
        "所以",
        "没有",
        "什么",
        "自己",
        "已经",
        "一个",
        "不是",
        "就是",
        "还是",
        "作为",
        "使用",
        "工具",
        "内容",
        "文章",
        "笔记",
        "分享",
        "今天",
        "觉得",
        "感觉",
        "可能",
        "需要",
        "时候",
        "之后",
        "之前",
        "然后",
        "这样",
        "那样",
        "非常",
        "比较",
        "真的",
        "其实",
        "首先",
        "其次",
        "最后",
        "总结",
        "例如",
        "比如",
    }
)

_TABOO_WORDS = ("赋能", "闭环", "颠覆", "王者", "抓手", "颗粒度", "对齐", "打法", "沉淀")


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


def _tokens(text: str) -> list[str]:
    raw = re.findall(r"#[\u4e00-\u9fff\w]{2,12}|[\u4e00-\u9fff]{2,6}|[a-zA-Z][a-zA-Z0-9]{1,12}", (text or "").lower())
    out: list[str] = []
    for t in raw:
        if t.startswith("#"):
            t = t.lstrip("#")
        if len(t) < 2 or t in _STOP:
            continue
        out.append(t)
    return out


def _split_tags_field(body: str) -> list[str]:
    parts = re.split(r"[,，、\s]+", body or "")
    return [p.strip() for p in parts if 2 <= len(p.strip()) <= 16]


def _trait_key(tr: dict[str, Any]) -> str:
    return f"{str(tr.get('dimension') or '').strip()}::{str(tr.get('label') or '').strip()}"


def _normalize_trait(tr: dict[str, Any]) -> dict[str, Any]:
    dim = str(tr.get("dimension") or "语气").strip()[:24] or "语气"
    label = str(tr.get("label") or "").strip()[:120]
    if not label:
        return {}
    ev = str(tr.get("evidence") or "").strip()[:200]
    default_on = tr.get("defaultOn")
    if default_on is False:
        on = False
    else:
        on = True
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
    max_items: int = 12,
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
    return ordered[:max_items]


def _detect_traits_from_text(blob: str, *, source_title: str = "") -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    b = blob or ""
    ev_snip = (source_title or b[:60]).strip()[:80]

    if re.search(r"先说结论|结论前置|先说重点", b):
        found.append(
            {"dimension": "立场", "label": "结论前置", "evidence": ev_snip, "defaultOn": True, "confidence": 0.85}
        )
    if re.search(r"适合|不适合|✅|❌", b):
        found.append(
            {
                "dimension": "结构",
                "label": "适合/不适合谁",
                "evidence": ev_snip,
                "defaultOn": True,
                "confidence": 0.8,
            }
        )
    if re.search(r"1️⃣|①|②|③|⚠️|💡|📌|✅", b):
        found.append(
            {
                "dimension": "结构",
                "label": "清单体 + emoji 锚点",
                "evidence": ev_snip,
                "defaultOn": True,
                "confidence": 0.82,
            }
        )
    if re.search(r"#[\u4e00-\u9fff\w]{2,10}", b):
        found.append(
            {
                "dimension": "平台",
                "label": "文末话题标签",
                "evidence": "正文含 # 标签",
                "defaultOn": True,
                "confidence": 0.78,
            }
        )
    you_cnt = len(re.findall(r"(?<![们])你", b))
    if you_cnt >= 3:
        found.append(
            {"dimension": "语气", "label": "称「你」、短句", "evidence": ev_snip, "defaultOn": True, "confidence": 0.76}
        )
    if re.search(r"场景|先定|再看|选型", b):
        found.append(
            {
                "dimension": "修辞",
                "label": "场景先于参数",
                "evidence": ev_snip,
                "defaultOn": True,
                "confidence": 0.74,
            }
        )
    for w in _TABOO_WORDS:
        if w in b and re.search(rf"不[爱喜要用]|反对|别用|少用|禁用", b):
            found.append(
                {
                    "dimension": "禁区",
                    "label": f"少用「{w}」等套话",
                    "evidence": ev_snip,
                    "defaultOn": True,
                    "confidence": 0.7,
                }
            )
            break
    sents = [s for s in re.split(r"[。！？\n]", b) if len(s.strip()) > 4]
    if sents:
        avg = sum(len(s) for s in sents) / len(sents)
        if avg <= 28:
            found.append(
                {
                    "dimension": "语气",
                    "label": "短句、节奏快",
                    "evidence": ev_snip,
                    "defaultOn": True,
                    "confidence": 0.72,
                }
            )
    return found


def extract_traits_from_materials(
    materials: list[dict[str, Any]],
    *,
    one_liner: str = "",
    existing_traits: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    discovered: list[dict[str, Any]] = []
    if one_liner.strip():
        discovered.extend(_detect_traits_from_text(one_liner, source_title="一句话定位"))
        discovered.append(
            {
                "dimension": "口吻",
                "label": "直给、少套话",
                "evidence": one_liner.strip()[:80],
                "defaultOn": True,
                "confidence": 0.7,
            }
        )

    for m in _learning_materials(materials):
        body = str(m.get("body") or "")
        title = str(m.get("title") or "")
        tid = str(m.get("experienceTemplateId") or "")
        blob = f"{title}\n{body}"

        if tid == "tags":
            for tag in _split_tags_field(body)[:12]:
                discovered.append(
                    {
                        "dimension": "修辞",
                        "label": tag,
                        "evidence": "记忆标签",
                        "defaultOn": True,
                        "confidence": 0.65,
                    }
                )
            continue
        if tid == "voice_pref":
            discovered.extend(_detect_traits_from_text(body, source_title=title))
            for w in _TABOO_WORDS:
                if w in body:
                    discovered.append(
                        {
                            "dimension": "禁区",
                            "label": f"不用「{w}」等",
                            "evidence": title or "表达偏好",
                            "defaultOn": True,
                            "confidence": 0.8,
                        }
                    )
            continue
        if tid in ("stance", "who_am_i", "turning_point"):
            discovered.extend(_detect_traits_from_text(body, source_title=title))
            continue

        mt = str(m.get("materialType") or "")
        if mt in ("published", "draft"):
            discovered.extend(_detect_traits_from_text(body, source_title=title))
        elif mt == "experience_card":
            discovered.extend(_detect_traits_from_text(body, source_title=title))

    return _merge_traits(existing_traits or [], discovered)


def extract_tag_cloud(
    materials: list[dict[str, Any]],
    *,
    one_liner: str = "",
    limit: int = 10,
) -> list[str]:
    counter: Counter[str] = Counter()
    for m in _learning_materials(materials):
        title = str(m.get("title") or "").strip()
        body = str(m.get("body") or "")
        tid = str(m.get("experienceTemplateId") or "")
        if tid == "tags":
            for tag in _split_tags_field(body):
                counter[tag] += 4
            continue
        for tok in _tokens(f"{title} {body}"):
            counter[tok] += 2
        for ht in re.findall(r"#[\u4e00-\u9fff\w]{2,12}", body):
            counter[ht.lstrip("#")] += 3
    for tok in _tokens(one_liner):
        counter[tok] += 1
    ranked = [w for w, _ in counter.most_common(limit * 2) if len(w) >= 2]
    out: list[str] = []
    seen: set[str] = set()
    for w in ranked:
        if w in seen:
            continue
        seen.add(w)
        out.append(w[:16])
        if len(out) >= limit:
            break
    return out


def _article_score_tokens(title: str, body: str) -> set[str]:
    return set(_tokens(f"{title} {body[:800]}"))


def infer_domains_from_materials(materials: list[dict[str, Any]]) -> list[dict[str, Any]]:
    articles = [
        m
        for m in _learning_materials(materials)
        if str(m.get("materialType") or "") in ("published", "draft")
    ]
    experiences = [
        m
        for m in _learning_materials(materials)
        if str(m.get("materialType") or "") == "experience_card"
    ]
    if not articles:
        if experiences:
            tpls = list(
                dict.fromkeys(
                    str(m.get("experienceTemplateId") or "").strip()
                    for m in experiences
                    if str(m.get("experienceTemplateId") or "").strip()
                )
            )[:5]
            return [
                {
                    "displayName": "经历沉淀",
                    "boundArticleTitles": [],
                    "boundExperienceTemplates": tpls,
                }
            ]
        return []

    if len(articles) == 1:
        a = articles[0]
        return [
            {
                "displayName": _domain_name_from_title(str(a.get("title") or "通用写作")),
                "boundArticleTitles": [str(a.get("title") or "").strip()[:200]],
                "boundExperienceTemplates": [],
            }
        ]

    # 按标题关键词粗聚类为 2～3 个场景
    clusters: list[dict[str, Any]] = []
    for art in articles[:12]:
        title = str(art.get("title") or "").strip()[:200]
        toks = _article_score_tokens(title, str(art.get("body") or ""))
        placed = False
        for cl in clusters:
            shared = len(toks & cl["tokens"])
            if shared >= 2 or (shared >= 1 and len(cl["articles"]) < 4):
                cl["articles"].append(art)
                cl["tokens"] |= toks
                placed = True
                break
        if not placed and len(clusters) < 3:
            clusters.append({"articles": [art], "tokens": set(toks)})
        elif not placed:
            clusters[0]["articles"].append(art)
            clusters[0]["tokens"] |= toks

    domains: list[dict[str, Any]] = []
    exp_tpls = [
        str(m.get("experienceTemplateId") or "").strip()
        for m in experiences
        if str(m.get("experienceTemplateId") or "").strip()
    ][:5]
    for cl in clusters:
        titles = [str(a.get("title") or "").strip()[:200] for a in cl["articles"] if str(a.get("title") or "").strip()]
        if not titles:
            continue
        name = _domain_name_from_title(titles[0])
        domains.append(
            {
                "displayName": name,
                "boundArticleTitles": titles[:8],
                "boundExperienceTemplates": exp_tpls[:3] if len(domains) == 0 else [],
            }
        )
    return domains[:4]


def _domain_name_from_title(title: str) -> str:
    t = title.strip()
    if re.search(r"测评|对比|怎么选|实测", t):
        return "测评种草"
    if re.search(r"教程|步骤|清单|避坑|checklist", t, re.I):
        return "教程清单"
    if re.search(r"复盘|总结|周报", t):
        return "复盘总结"
    if len(t) > 12:
        return t[:10] + "…"
    return t[:12] or "通用写作"


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
        return "先完善定位，并添加至少 1 条简历或成稿"
    if maturity == "sketch":
        if art < 1:
            return "再添加 1 篇成稿，可进入「草图+」"
        return "继续添加素材并学习，提炼更多特色"
    if maturity == "sketch_plus":
        need = max(0, 3 - trait_count)
        if need > 0:
            return f"再学习或编辑特色，还差 {need} 条可达「已建立」"
        return "特色接近完备，可去写一篇验证"
    if maturity == "ready":
        return "风格已建立，写作将优先引用已开启的特色"
    return "素材有更新时，建议再次学习"


def run_author_ip_distill(
    profile: dict[str, Any],
    materials: list[dict[str, Any]],
    *,
    one_liner: str = "",
    mode: str = "full",
) -> dict[str, Any]:
    """返回更新后的 profile（不持久化）。full/lite 优先 LLM，失败回退规则引擎。"""
    prof = dict(profile) if isinstance(profile, dict) else {}
    vitality = prof.get("vitality") if isinstance(prof.get("vitality"), dict) else {}
    prev_snapshot = {
        "traitLabels": [str(t.get("label") or "") for t in (prof.get("traits") or []) if isinstance(t, dict)],
        "tagCloud": list(vitality.get("tagCloud") or []) if isinstance(vitality.get("tagCloud"), list) else [],
        "recentChange": vitality.get("recentChange"),
    }

    exp_n, art_n, learned_n = material_counts_for_learning(materials)
    learn_mode = mode if mode in ("lite", "full") else "full"
    existing_traits = prof.get("traits") if isinstance(prof.get("traits"), list) else []

    tag_cloud = extract_tag_cloud(materials, one_liner=one_liner)
    top3 = _top_contributors(materials)
    distill_source = "heuristic"

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
                        existing_traits=existing_traits,
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
                existing_traits=existing_traits,
                mode=learn_mode,
            )
        except Exception:
            llm_out = None

    if llm_out:
        distill_source = "llm"
        if llm_out.get("tagCloud"):
            tag_cloud = list(llm_out["tagCloud"])

    if learn_mode == "full":
        if llm_out and llm_out.get("traits"):
            heuristic_traits = extract_traits_from_materials(
                materials,
                one_liner=one_liner,
                existing_traits=[],
            )
            merged = _merge_traits(
                existing_traits,
                list(llm_out["traits"]) + heuristic_traits,
                max_items=12,
            )
            if merged:
                prof["traits"] = merged
                if heuristic_traits:
                    distill_source = "llm+heuristic"
        else:
            traits = extract_traits_from_materials(
                materials,
                one_liner=one_liner,
                existing_traits=existing_traits,
            )
            if traits:
                prof["traits"] = traits

        domains: list[dict[str, Any]] = []
        if llm_out and llm_out.get("domains"):
            domains = list(llm_out["domains"])
        if not domains:
            domains = infer_domains_from_materials(materials)
        if domains:
            prof["domains"] = domains

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

"""author_ip_distill 蒸馏逻辑单测。"""
from __future__ import annotations

from app.author_ip_distill import (
    extract_tag_cloud,
    extract_traits_from_materials,
    infer_domains_from_materials,
    material_in_style_learning,
    run_author_ip_distill,
)


def test_material_learning_flag():
    assert material_in_style_learning({"body": "x", "includeInStyleLearning": True})
    assert not material_in_style_learning({"body": "x", "includeInStyleLearning": False})
    assert not material_in_style_learning({"body": "x", "materialType": "third_party"})


def test_extract_tag_cloud_from_tags_card():
    mats = [
        {
            "materialType": "experience_card",
            "experienceTemplateId": "tags",
            "title": "记忆标签",
            "body": "AI工具, 测评, 避坑",
            "includeInStyleLearning": True,
        }
    ]
    tags = extract_tag_cloud(mats)
    assert "AI工具" in tags or "测评" in tags


def test_extract_traits_conclusion_first():
    mats = [
        {
            "materialType": "published",
            "title": "测评文",
            "body": "先说结论：适合小白。✅ 适合创作者",
            "includeInStyleLearning": True,
        }
    ]
    traits = extract_traits_from_materials(mats)
    labels = [t["label"] for t in traits]
    assert any("结论" in x for x in labels)


def test_infer_domains_two_articles():
    mats = [
        {
            "materialType": "published",
            "title": "5 款 AI 写作工具测评",
            "body": "先说结论 测评对比",
            "includeInStyleLearning": True,
        },
        {
            "materialType": "published",
            "title": "教程：避坑三步清单",
            "body": "步骤 清单 避坑",
            "includeInStyleLearning": True,
        },
    ]
    domains = infer_domains_from_materials(mats)
    assert len(domains) >= 1
    assert domains[0].get("boundArticleTitles")


def test_merge_traits_round_robin_across_dimensions() -> None:
    discovered = [
        {"dimension": "立场", "label": f"立场{i}", "defaultOn": True, "confidence": 0.9 - i * 0.01}
        for i in range(4)
    ] + [
        {"dimension": "结构", "label": f"结构{i}", "defaultOn": True, "confidence": 0.85 - i * 0.01}
        for i in range(4)
    ] + [
        {"dimension": "语气", "label": f"语气{i}", "defaultOn": True, "confidence": 0.8 - i * 0.01}
        for i in range(4)
    ]
    from app.author_ip_distill import _merge_traits

    merged = _merge_traits([], discovered, max_items=9)
    dims = [t["dimension"] for t in merged]
    assert len(set(dims)) >= 3
    assert dims.count("立场") <= 4
    prof = {"traits": [], "vitality": {}}
    mats = [
        {
            "materialType": "experience_card",
            "title": "我是谁",
            "body": "产品经理",
            "includeInStyleLearning": True,
        }
    ]
    out = run_author_ip_distill(prof, mats, one_liner="帮职场人写复盘", mode="full")
    assert out["vitality"].get("lastLearnedAt")
    assert out["vitality"].get("materialSummary")

"""自媒体发布：从勾选笔记合并参考素材。"""
from __future__ import annotations

from unittest.mock import patch

from app.social_publish_draft import (
    resolve_social_publish_material,
    resolve_social_publish_material_from_notes,
)


def test_resolve_uses_fallback_when_merge_loads_no_notes():
    with patch("app.social_publish_draft._merge_reference_for_social") as mock_merge:
        mock_merge.return_value = ("请介绍 AI Native 应用架构", {"notes_loaded": 0})
        with patch(
            "app.social_publish_draft._fallback_note_bodies_for_social",
            return_value="【笔记：测】\n" + "正文" * 30,
        ):
            out = resolve_social_publish_material_from_notes(
                "user-1",
                selected_note_ids=["nid-1"],
            )
    assert len(out) >= 40
    assert "正文" in out


def test_resolve_uses_merge_when_use_rag_even_with_long_bodies():
    long_bodies = "【笔记：测】\n" + "正文" * 200
    with patch("app.social_publish_draft._merge_reference_for_social") as mock_merge:
        mock_merge.return_value = ("合并后的素材" * 50, {"notes_loaded": 1})
        with patch(
            "app.social_publish_draft._fallback_note_bodies_for_social",
            return_value=long_bodies,
        ):
            out = resolve_social_publish_material_from_notes(
                "user-1",
                selected_note_ids=["nid-1"],
                use_rag=True,
            )
    mock_merge.assert_called_once()
    assert "合并后的素材" in out


def test_resolve_raises_when_no_note_body():
    with patch("app.social_publish_draft._merge_reference_for_social") as mock_merge:
        mock_merge.return_value = ("", {"notes_loaded": 0})
        with patch("app.social_publish_draft._fallback_note_bodies_for_social", return_value=""):
            try:
                resolve_social_publish_material_from_notes("user-1", selected_note_ids=["nid-1"])
                assert False, "expected notes_material_empty"
            except RuntimeError as exc:
                assert str(exc) == "notes_material_empty"


def test_resolve_material_from_prompt_text_without_notes():
    prompt = "用户问题：如何做产品复盘\n\n" + "通识回答：" + ("要点" * 20)
    out = resolve_social_publish_material(None, material_text=prompt)
    assert len(out) >= 40
    assert "产品复盘" in out


def test_resolve_composer_prompt_accepts_15_chars():
    text = "请根据以下内容写小红书笔记哈哈"
    assert len(text) >= 15
    out = resolve_social_publish_material(
        None,
        material_text=text,
        source_type="composer_prompt",
    )
    assert out == text


def test_resolve_composer_prompt_rejects_below_15():
    try:
        resolve_social_publish_material(
            None,
            material_text="写个小红书",
            source_type="composer_prompt",
        )
        assert False, "expected material_too_short"
    except RuntimeError as exc:
        assert str(exc) == "material_too_short"


def test_resolve_material_prompt_too_short_without_composer_source():
    try:
        resolve_social_publish_material(None, material_text="太短")
        assert False, "expected material_too_short"
    except RuntimeError as exc:
        assert str(exc) == "material_too_short"

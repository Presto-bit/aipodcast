"""自媒体发布素材：去除 RAG 说明块。"""

from app.social_publish_draft import _strip_social_material_boilerplate


def test_strip_social_material_boilerplate_removes_rag_header():
    raw = (
        "【勾选笔记·摘要与向量检索】\n\n"
        "📌 先说结论\n\n"
        "【来源清单】用户勾选笔记共 **1** 条\n"
        "---\n"
        "## 异步摘要（机器生成）\n"
        "### 摘要 [1] 测试书\n"
        "这是真正的笔记正文，应保留在素材里。\n"
    )
    out = _strip_social_material_boilerplate(raw)
    assert "【勾选笔记" not in out
    assert "【来源清单】" not in out
    assert "真正的笔记正文" in out

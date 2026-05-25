from app.social_compliance import (
    apply_compliance_to_xhs_fields,
    rule_soften_text,
    scan_text,
    xhs_fields_from_pack,
)


def test_scan_detects_absolute() -> None:
    hits = scan_text("这是最好的产品", "body")
    assert any(h.category == "absolute" for h in hits)


def test_does_not_replace_colloquial_first() -> None:
    text = "第一时间告诉你，第一步先做好功课"
    softened, n = rule_soften_text(text)
    assert softened == text
    assert n == 0


def test_replaces_marketing_first_phrase() -> None:
    text = "全网第一名防晒，必入"
    softened, _n = rule_soften_text(text)
    assert "第一名" not in softened
    assert "表现亮眼" in softened


def test_rule_soften_and_pass() -> None:
    fields = xhs_fields_from_pack(
        titles=["最好的防晒推荐"],
        opening_30="你是不是也怕踩雷？",
        body="加微信领取资料",
        interaction="私信我",
        tags=["好物分享"],
        cover_suggestions=[],
    )
    out, meta = apply_compliance_to_xhs_fields(fields)
    assert meta["status"] in ("passed", "auto_softened")
    assert "加微信" not in out.get("body", "")

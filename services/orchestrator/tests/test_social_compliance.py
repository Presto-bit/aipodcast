from app.social_compliance import apply_compliance_to_xhs_fields, scan_text, xhs_fields_from_pack


def test_scan_detects_absolute() -> None:
    hits = scan_text("这是最好的产品", "body")
    assert any(h.category == "absolute" for h in hits)


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

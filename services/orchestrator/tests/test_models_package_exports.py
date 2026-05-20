"""models 包拆分后须保持对以下划线 helper 的 re-export。"""


def test_models_reexports_private_resolve_helpers():
    from app.models import _resolve_user_uuid_from_ref, _resolve_user_uuid_or_none

    assert callable(_resolve_user_uuid_from_ref)
    assert callable(_resolve_user_uuid_or_none)

"""models 包拆分后须保持对以下划线 helper 的 re-export，且 _core 能调用 schema 内 ensure_*。"""


def test_models_reexports_private_resolve_helpers():
    from app.models import _resolve_user_uuid_from_ref, _resolve_user_uuid_or_none

    assert callable(_resolve_user_uuid_from_ref)
    assert callable(_resolve_user_uuid_or_none)


def test_core_binds_schema_ensure_helpers():
    from app.models import _core

    assert callable(_core.ensure_usage_events_user_id_schema)
    assert callable(_core.ensure_jobs_trash_schema)

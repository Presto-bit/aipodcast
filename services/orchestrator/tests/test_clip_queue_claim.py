"""剪辑队列入队 claim / revert 的输入校验（不依赖真实 PG）。"""

import pytest


def test_try_claim_transcription_invalid_uuid_returns_false() -> None:
    pytest.importorskip("psycopg2")
    from app.clip_store import try_claim_clip_transcription_queued

    assert try_claim_clip_transcription_queued(project_id="not-a-uuid", user_uuid=None) is False


def test_try_claim_export_invalid_uuid_returns_false() -> None:
    pytest.importorskip("psycopg2")
    from app.clip_store import try_claim_clip_export_queued

    assert try_claim_clip_export_queued(project_id="", user_uuid=None) is False


def test_revert_transcription_invalid_restore_rejected() -> None:
    pytest.importorskip("psycopg2")
    from app.clip_store import revert_clip_transcription_after_enqueue_failed

    assert (
        revert_clip_transcription_after_enqueue_failed(
            project_id="bad-id",
            user_uuid=None,
            restore_status="queued",
        )
        is False
    )


def test_revert_export_invalid_restore_rejected() -> None:
    pytest.importorskip("psycopg2")
    from app.clip_store import revert_clip_export_after_enqueue_failed

    assert (
        revert_clip_export_after_enqueue_failed(
            project_id="bad-id",
            user_uuid=None,
            restore_status="queued",
        )
        is False
    )

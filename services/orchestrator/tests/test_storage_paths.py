"""对象存储路径命名（纯函数，无 DB / 网络）。"""
from app.storage_paths import job_artifact_base, note_upload_object_key


def test_note_upload_with_owner():
    assert note_upload_object_key("n1", "pdf", "u-uuid") == "notes/u/u-uuid/n1.pdf"


def test_note_upload_without_owner():
    assert note_upload_object_key("n1", "pdf", None) == "notes/n1.pdf"
    assert note_upload_object_key("n1", "pdf", "") == "notes/n1.pdf"


def test_job_base_with_owner():
    assert job_artifact_base("j1", "user-uuid") == "jobs/u/user-uuid/j1"


def test_job_base_without_owner():
    assert job_artifact_base("j1", None) == "jobs/j1"

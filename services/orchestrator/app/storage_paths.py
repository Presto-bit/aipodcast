"""对象存储 key 命名：新写入带用户命名空间，历史 DB 中旧 key 仍可读取。"""


def note_upload_object_key(note_id: str, ext: str, owner_user_uuid: str | None) -> str:
    e = (ext or "bin").strip().lower().lstrip(".")
    oid = (owner_user_uuid or "").strip()
    if oid:
        return f"notes/u/{oid}/{note_id}.{e}"
    return f"notes/{note_id}.{e}"


def job_artifact_base(job_id: str, owner_user_uuid: str | None) -> str:
    jid = (job_id or "").strip()
    if not jid:
        return "jobs/_invalid"
    oid = (owner_user_uuid or "").strip()
    if oid:
        return f"jobs/u/{oid}/{jid}"
    return f"jobs/{jid}"


def job_cover_object_key(job_id: str, owner_user_uuid: str | None, ext: str = "jpg") -> str:
    e = (ext or "jpg").strip().lower().lstrip(".")
    if not e:
        e = "jpg"
    return f"{job_artifact_base(job_id, owner_user_uuid)}/cover.{e}"

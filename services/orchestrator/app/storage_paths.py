"""对象存储 key 命名：新写入带用户命名空间，历史 DB 中旧 key 仍可读取。"""

import hashlib


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


def notebook_cover_object_keys(owner_user_uuid: str, notebook_name: str, ext: str) -> tuple[str, str]:
    """同一笔记本缩略与完整图各一 key（重命名笔记本会重置封面，避免 hash 与名称不一致）。"""
    e = (ext or "jpg").strip().lower().lstrip(".") or "jpg"
    oid = (owner_user_uuid or "").strip()
    nb = (notebook_name or "").strip()
    h = hashlib.sha256(f"{oid}\n{nb}".encode("utf-8")).hexdigest()[:24]
    base = f"notes/u/{oid}/notebook-covers/{h}"
    return f"{base}_thumb.{e}", f"{base}_full.{e}"

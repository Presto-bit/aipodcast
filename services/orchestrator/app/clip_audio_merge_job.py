"""剪辑多段素材合并为整轨：流式 I/O + 分层编码（clip_routes 异步调度调用）。"""

from __future__ import annotations

import logging
import tempfile
import uuid
from pathlib import Path
from typing import Any

from .clip_audio_merge import merge_audio_files_layered, validate_staging_segments_for_volc
from .clip_store import (
    get_clip_project,
    prune_clip_audio_segment_transcripts,
    set_clip_audio_merge_state,
    update_clip_project_audio,
)
from .object_store import delete_object_key, download_object_to_path, upload_file_path

logger = logging.getLogger(__name__)


def run_clip_audio_merge_sync(project_id: str, uid: str | None) -> None:
    """
    同步执行合并（在线程池中调用）。
    成功：audio_merge_status=idle；失败：failed 并写 audio_merge_error。
    """
    # 延迟导入，避免与 clip_routes 顶层循环依赖
    from .routes import clip_routes as cr

    set_clip_audio_merge_state(project_id=project_id, user_uuid=uid, status="running", error=None)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        set_clip_audio_merge_state(project_id=project_id, user_uuid=uid, status="failed", error="工程不存在")
        raise RuntimeError("工程不存在")

    staging = cr._material_segments_from_row(row)
    if not staging:
        set_clip_audio_merge_state(project_id=project_id, user_uuid=uid, status="idle", error=None)
        return

    old_main = str(row.get("audio_object_key") or "").strip() or None
    owner_seg = uid or "anon"
    merged_key: str | None = None
    meta: list[dict[str, Any]] = []

    try:
        with tempfile.TemporaryDirectory(prefix="fyv_clip_merge_") as td:
            td_path = Path(td)
            paths: list[Path] = []
            for i, seg in enumerate(staging):
                key = str(seg.get("key") or "").strip()
                if not key:
                    continue
                ext = Path(str(seg.get("filename") or "seg.bin")).suffix or ".bin"
                p = td_path / f"seg_{i:03d}{ext}"
                download_object_to_path(key, p)
                sz = int(p.stat().st_size)
                paths.append(p)
                meta.append(
                    {
                        "key": key,
                        "filename": str(seg.get("filename") or ""),
                        "mime": str(seg.get("mime") or ""),
                        "size_bytes": sz,
                    }
                )
            if len(paths) < 1:
                raise RuntimeError("分段数据无效")
            validate_staging_segments_for_volc(segment_meta=meta, temp_paths=paths)
            merged_path, mime, filename = merge_audio_files_layered(paths, td_path)
            size_bytes = int(merged_path.stat().st_size)
            try:
                cr._apply_channel_ids_from_audio_file(project_id=project_id, user_uuid=uid, file_path=merged_path)
            except Exception:
                logger.exception("clip merge channel_autodetect failed project_id=%s", project_id)

            suffix = Path(filename).suffix or ".m4a"
            merged_key = f"clip/{owner_seg}/{project_id}/merged_{uuid.uuid4().hex[:12]}{suffix}"
            upload_file_path(merged_key, merged_path, mime)

        ok = update_clip_project_audio(
            project_id=project_id,
            user_uuid=uid,
            object_key=merged_key,
            filename=filename,
            mime=mime,
            size_bytes=size_bytes,
            source_segments=meta,
            preserve_segment_transcript_cache=True,
        )
        if not ok:
            if merged_key:
                delete_object_key(merged_key)
            raise RuntimeError("合并后写入主音频失败")

        seg_key_set = {str(m.get("key") or "").strip() for m in meta if str(m.get("key") or "").strip()}
        if old_main and old_main != merged_key and old_main not in seg_key_set:
            delete_object_key(old_main)
        prune_clip_audio_segment_transcripts(
            project_id=project_id,
            user_uuid=uid,
            keep_keys=[str(m.get("key") or "").strip() for m in meta if str(m.get("key") or "").strip()],
        )
        set_clip_audio_merge_state(project_id=project_id, user_uuid=uid, status="idle", error=None)
        from .clip_browser_preview import schedule_prewarm_browser_playback_object_key

        schedule_prewarm_browser_playback_object_key(merged_key)
    except Exception as exc:
        if merged_key:
            delete_object_key(merged_key)
        logger.exception("clip merge staged audio failed project_id=%s", project_id)
        set_clip_audio_merge_state(project_id=project_id, user_uuid=uid, status="failed", error=str(exc)[:800])
        raise

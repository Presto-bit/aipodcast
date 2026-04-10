"""为成片 MP3 写入 ID3（标题/艺人/专辑）与 ID3v2 章节（CHAP/CTOC），供导出与分发。"""

from __future__ import annotations

import io
import re
from typing import Any


def _ascii_element_id(prefix: str, index: int) -> str:
    raw = f"{prefix}{index:03d}"
    safe = re.sub(r"[^A-Za-z0-9]", "_", raw)[:64] or f"{prefix}{index:03d}"
    return safe


def build_export_mp3(
    mp3_bytes: bytes,
    *,
    title: str = "",
    artist: str = "",
    album: str = "",
    chapters: list[dict[str, Any]] | None = None,
) -> bytes:
    """
    在 MP3 字节流上嵌入 ID3v2.4 标签与可选章节。
    mutagen 不可用时原样返回。
    """
    data = bytes(mp3_bytes or b"")
    if not data:
        return data
    try:
        from mutagen.id3 import (
            CHAP,
            CTOC,
            CTOCFlags,
            Encoding,
            ID3,
            TALB,
            TIT2,
            TPE1,
        )
        from mutagen.mp3 import MP3
    except ImportError:
        return data

    buf = io.BytesIO(data)
    try:
        audio = MP3(buf, ID3=ID3)
    except Exception:
        return data

    if audio.tags is None:
        try:
            audio.add_tags()
        except Exception:
            return data

    tags = audio.tags
    for k in list(tags.keys()):
        ks = str(k)
        if ks.startswith("CHAP:") or ks.startswith("CTOC:"):
            try:
                del tags[k]
            except Exception:
                pass

    def _del(frame_id: str) -> None:
        try:
            tags.delall(frame_id)
        except Exception:
            pass

    t = (title or "").strip()
    if t:
        _del("TIT2")
        tags.add(TIT2(encoding=Encoding.UTF8, text=t))
    ar = (artist or "").strip()
    if ar:
        _del("TPE1")
        tags.add(TPE1(encoding=Encoding.UTF8, text=ar))
    al = (album or "").strip()
    if al:
        _del("TALB")
        tags.add(TALB(encoding=Encoding.UTF8, text=al))

    ch_list = [c for c in (chapters or []) if isinstance(c, dict)]
    if ch_list:
        child_ids: list[str] = []
        for i, ch in enumerate(ch_list):
            cid = _ascii_element_id("fyv", i)
            child_ids.append(cid)
            start = int(ch.get("start_ms") or 0)
            end = int(ch.get("end_ms") or start)
            if end <= start:
                end = start + 1
            tit = (str(ch.get("title") or f"章节 {i + 1}")).strip()[:200] or f"章节 {i + 1}"
            tags.add(
                CHAP(
                    element_id=cid,
                    start_time=start,
                    end_time=end,
                    start_offset=0xFFFFFFFF,
                    end_offset=0xFFFFFFFF,
                    sub_frames=[TIT2(encoding=Encoding.UTF8, text=tit)],
                )
            )
        tags.add(
            CTOC(
                element_id="toc",
                flags=CTOCFlags.TOP_LEVEL | CTOCFlags.ORDERED,
                child_element_ids=child_ids,
                sub_frames=[TIT2(encoding=Encoding.UTF8, text="章节")],
            )
        )

    try:
        buf.seek(0)
        audio.save(buf, v2_version=4)
        return buf.getvalue()
    except Exception:
        return data

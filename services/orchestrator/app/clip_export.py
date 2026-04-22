"""根据词级时间轴与排除列表，用 ffmpeg 从原始音频导出剪辑后 MP3。"""

from __future__ import annotations

import json
import logging
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _merge_segments(words: list[dict[str, Any]], gap_ms: int) -> list[tuple[int, int]]:
    segs: list[tuple[int, int]] = []
    for w in words:
        try:
            s = int(w.get("s_ms", 0))
            e = int(w.get("e_ms", s))
        except (TypeError, ValueError):
            continue
        if e <= s:
            continue
        if not segs:
            segs.append((s, e))
            continue
        ls, le = segs[-1]
        if s - le <= gap_ms:
            segs[-1] = (ls, max(le, e))
        else:
            segs.append((s, e))
    return segs


def _clip_kept_to_time_range(
    kept: list[dict[str, Any]],
    start_ms: int | None,
    end_ms: int | None,
) -> list[dict[str, Any]]:
    """按导出时间窗裁剪词块时间（闭开区间与词区间求交）。"""
    if start_ms is None and end_ms is None:
        return kept
    if end_ms is not None and end_ms <= 0:
        return kept
    out: list[dict[str, Any]] = []
    for w in kept:
        try:
            s = int(w.get("s_ms", 0))
            e = int(w.get("e_ms", s))
        except (TypeError, ValueError):
            continue
        if e <= s:
            continue
        if end_ms is not None and end_ms > 0 and s >= end_ms:
            continue
        if start_ms is not None and start_ms > 0 and e <= start_ms:
            continue
        ws, we = s, e
        if start_ms is not None and start_ms > 0:
            ws = max(ws, start_ms)
        if end_ms is not None and end_ms > 0:
            we = min(we, end_ms)
        if we <= ws:
            continue
        nw = dict(w)
        nw["s_ms"] = ws
        nw["e_ms"] = we
        out.append(nw)
    return out


def _kept_words_sorted(normalized: dict[str, Any], excluded_word_ids: set[str]) -> list[dict[str, Any]]:
    words = normalized.get("words") if isinstance(normalized.get("words"), list) else []
    kept: list[dict[str, Any]] = []
    for w in words:
        if not isinstance(w, dict):
            continue
        wid = str(w.get("id") or "").strip()
        if not wid or wid in excluded_word_ids:
            continue
        kept.append(w)
    kept.sort(key=lambda x: int(x.get("s_ms", 0) or 0))
    return kept


def _read_int_env(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name) or str(default)))
    except (TypeError, ValueError):
        return default


def _read_float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name) or str(default))
    except (TypeError, ValueError):
        return default


def resolve_export_loudnorm_i_lufs(project_value: Any) -> float:
    """
    工程列 repair_loudness_i_lufs 优先，否则 CLIP_EXPORT_LOUDNORM_I，否则 -16。
    限制在 [-24, -10] 内，避免误配导致 ffmpeg 异常。
    """
    if project_value is not None:
        try:
            x = float(project_value)
            if math.isfinite(x):
                return max(-24.0, min(-10.0, x))
        except (TypeError, ValueError):
            pass
    return _read_float_env("CLIP_EXPORT_LOUDNORM_I", -16.0)


def _afade_ms_for_duration(dur_ms: int, fade_ms: int) -> str | None:
    """返回 afade 滤镜链；dur 过短则跳过以免 ffmpeg 报错。"""
    if dur_ms < fade_ms * 2 + 20:
        return None
    st_out = max(0.0, (dur_ms - fade_ms) / 1000.0)
    d = fade_ms / 1000.0
    return f"afade=t=in:st=0:d={d:.4f},afade=t=out:st={st_out:.4f}:d={d:.4f}"


def _read_filter_batch_max() -> int:
    """
    单次 filter_complex 最多拼接多少个小段；超出则分多遍生成中间 MP3 再 concat 复制拼接。
    0 或负数表示不限制（极长稿慎用）。默认 320，可用环境变量 CLIP_EXPORT_FILTER_BATCH 覆盖。
    """
    raw = (os.getenv("CLIP_EXPORT_FILTER_BATCH") or "").strip()
    if not raw:
        return 320
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return 320
    return 0 if v < 0 else v


def _word_chain_segments(
    kept: list[dict[str, Any]],
    *,
    max_bridge_ms: int,
    long_pause_ms: int,
    long_pause_cap_ms: int,
) -> list[tuple[int, int]]:
    """与逐段导出相同的 (起点 ms, 时长 ms) 序列，供单次 filter_complex 使用。"""
    spans: list[tuple[int, int]] = []
    n_kept = len(kept)
    for i, w in enumerate(kept):
        s = int(w.get("s_ms", 0))
        e = int(w.get("e_ms", s))
        if e <= s:
            continue
        spans.append((s, e - s))
        if i >= n_kept - 1:
            break
        wn = kept[i + 1]
        ns = int(wn.get("s_ms", 0))
        gap = max(0, ns - e)
        if gap <= 0:
            continue
        if long_pause_ms > 0 and gap >= long_pause_ms:
            bridge = min(gap, max(long_pause_cap_ms, 1))
        else:
            bridge = min(gap, max_bridge_ms)
        spans.append((e, bridge))
    return spans


def _build_atrim_concat_filter_script(segments: list[tuple[int, int]], afade_ms: int) -> str:
    """多段 atrim + concat，输出标签 [out]。"""
    branches: list[str] = []
    labels: list[str] = []
    for idx, (s_ms, dur_ms) in enumerate(segments):
        dur_ms = max(30, int(dur_ms))
        s_sec = s_ms / 1000.0
        d_sec = dur_ms / 1000.0
        lab = f"s{idx}"
        chain = f"atrim=start={s_sec:.6f}:duration={d_sec:.6f},asetpts=PTS-STARTPTS"
        af = _afade_ms_for_duration(dur_ms, afade_ms)
        if af:
            chain = f"{chain},{af}"
        branches.append(f"[0:a]{chain}[{lab}]")
        labels.append(f"[{lab}]")
    n = len(labels)
    if n == 0:
        raise RuntimeError("filter_complex：无分段")
    concat_in = "".join(labels)
    tail = f"{concat_in}concat=n={n}:v=0:a=1[out]"
    return ";".join(branches) + ";" + tail


def _run_filter_complex_script_to_mp3(
    ffmpeg_bin: str,
    inp: str,
    out_path: Path,
    script_path: Path,
    *,
    lame_q: int,
) -> None:
    q = max(0, min(9, int(lame_q)))
    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        inp,
        "-filter_complex_script",
        str(script_path),
        "-map",
        "[out]",
        "-c:a",
        "libmp3lame",
        "-q:a",
        str(q),
        str(out_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=3600)
    if not out_path.is_file() or out_path.stat().st_size < 32:
        raise RuntimeError("ffmpeg filter_complex 未生成有效 MP3")


def _export_segments_filter_concat(
    ffmpeg_bin: str,
    td_path: Path,
    inp: str,
    segments: list[tuple[int, int]],
    afade_ms: int,
    *,
    segment_lame_q: int,
    out_mp3: Path,
) -> None:
    """
    从同一输入一次性切出多段并编码为单轨 MP3（替代每段起一个 ffmpeg 子进程）。
    段数过多时分批写入多个中间文件再 concat 协议拼接（流复制）。
    """
    if not segments:
        raise RuntimeError("无分段可导出")
    batch_cap = _read_filter_batch_max()
    if batch_cap == 0 or len(segments) <= batch_cap:
        script_path = td_path / "fc_export.txt"
        script_path.write_text(_build_atrim_concat_filter_script(segments, afade_ms), encoding="utf-8")
        _run_filter_complex_script_to_mp3(ffmpeg_bin, inp, out_mp3, script_path, lame_q=segment_lame_q)
        return

    chunk_paths: list[Path] = []
    for b_start in range(0, len(segments), batch_cap):
        batch = segments[b_start : b_start + batch_cap]
        script_path = td_path / f"fc_export_{b_start}.txt"
        script_path.write_text(_build_atrim_concat_filter_script(batch, afade_ms), encoding="utf-8")
        chunk = td_path / f"fc_chunk_{b_start:05d}.mp3"
        _run_filter_complex_script_to_mp3(ffmpeg_bin, inp, chunk, script_path, lame_q=segment_lame_q)
        chunk_paths.append(chunk)
    _concat_demuxer_mp3(ffmpeg_bin, td_path, chunk_paths, out_mp3)


def _concat_demuxer_mp3(ffmpeg_bin: str, td_path: Path, parts: list[Path], out_mp3: Path) -> None:
    list_file = td_path / "concat.txt"
    lines = "\n".join([f"file '{p.name}'" for p in parts])
    list_file.write_text(lines + "\n", encoding="utf-8")
    cmd2 = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_file),
        "-c",
        "copy",
        str(out_mp3),
    ]
    subprocess.run(cmd2, check=True, cwd=str(td_path), capture_output=True, timeout=600)
    if not out_mp3.is_file():
        raise RuntimeError("ffmpeg 拼接失败")


def _loudnorm_mp3(
    ffmpeg_bin: str,
    inp: Path,
    out_mp3: Path,
    *,
    i_lufs: float,
    tp: float,
    lra: float,
    lame_q: int = 2,
) -> None:
    """单段 loudnorm（含真峰值约束），输出 libmp3lame。"""
    filt = f"loudnorm=I={i_lufs}:TP={tp}:LRA={lra}"
    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(inp),
        "-af",
        filt,
        "-c:a",
        "libmp3lame",
        "-q:a",
        str(max(0, min(9, int(lame_q)))),
        str(out_mp3),
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=900)
    if not out_mp3.is_file() or out_mp3.stat().st_size < 32:
        raise RuntimeError("loudnorm 导出失败")


def _loudnorm_json_from_stderr(stderr_text: str) -> dict[str, Any] | None:
    """解析 loudnorm print_format=json 的首遍测量块（stderr 内嵌 JSON）。"""
    anchor = '"input_i"'
    pos = stderr_text.find(anchor)
    if pos < 0:
        return None
    start = stderr_text.rfind("{", 0, pos)
    if start < 0:
        return None
    depth = 0
    for j in range(start, len(stderr_text)):
        c = stderr_text[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(stderr_text[start : j + 1])
                except json.JSONDecodeError:
                    return None
    return None


def _loudnorm_scalar_str(d: dict[str, Any], key: str) -> str:
    v = d.get(key)
    if v is None:
        raise RuntimeError(f"loudnorm JSON 缺少 {key}")
    return str(v).strip()


def _loudnorm_mp3_two_pass(
    ffmpeg_bin: str,
    inp: Path,
    out_mp3: Path,
    *,
    i_lufs: float,
    tp: float,
    lra: float,
    lame_q: int = 2,
) -> None:
    """
    EBU R128 两遍 loudnorm：首遍测量、二遍带 measured_* + linear，真峰值更稳、少抽吸感。
    参考 ffmpeg Wiki / loudnorm 推荐工作流；耗时约为单遍约 2 倍。
    """
    p1 = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-y",
        "-i",
        str(inp),
        "-af",
        f"loudnorm=I={i_lufs}:TP={tp}:LRA={lra}:print_format=json",
        "-f",
        "null",
        "-",
    ]
    r1 = subprocess.run(p1, check=True, capture_output=True, timeout=900)
    txt = (r1.stderr or b"").decode("utf-8", errors="replace")
    j = _loudnorm_json_from_stderr(txt)
    if not j:
        raise RuntimeError("loudnorm 首遍未解析到测量 JSON")
    filt2 = (
        f"loudnorm=I={i_lufs}:TP={tp}:LRA={lra}:"
        f"measured_I={_loudnorm_scalar_str(j, 'input_i')}:"
        f"measured_LRA={_loudnorm_scalar_str(j, 'input_lra')}:"
        f"measured_TP={_loudnorm_scalar_str(j, 'input_tp')}:"
        f"measured_thresh={_loudnorm_scalar_str(j, 'input_thresh')}:"
        f"offset={_loudnorm_scalar_str(j, 'target_offset')}:linear=true"
    )
    cmd2 = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(inp),
        "-af",
        filt2,
        "-c:a",
        "libmp3lame",
        "-q:a",
        str(max(0, min(9, int(lame_q)))),
        str(out_mp3),
    ]
    subprocess.run(cmd2, check=True, capture_output=True, timeout=900)
    if not out_mp3.is_file() or out_mp3.stat().st_size < 32:
        raise RuntimeError("loudnorm 二遍导出失败")


def _export_word_chain_with_bridges(
    ffmpeg_bin: str,
    td_path: Path,
    inp: str,
    kept: list[dict[str, Any]],
    *,
    max_bridge_ms: int,
    afade_ms: int,
    long_pause_ms: int = 0,
    long_pause_cap_ms: int = 500,
    segment_lame_q: int = 4,
) -> Path:
    """逐词切段，词间仅保留源音频中最多 max_bridge_ms 的「桥接」静音（含自然 room tone），再拼接。"""
    segments = _word_chain_segments(
        kept,
        max_bridge_ms=max_bridge_ms,
        long_pause_ms=long_pause_ms,
        long_pause_cap_ms=long_pause_cap_ms,
    )
    if not segments:
        raise RuntimeError("词链导出：无有效片段")
    raw = td_path / "chain_raw.mp3"
    _export_segments_filter_concat(
        ffmpeg_bin,
        td_path,
        inp,
        segments,
        afade_ms,
        segment_lame_q=segment_lame_q,
        out_mp3=raw,
    )
    return raw


def _tag_mp3_metadata(ffmpeg_bin: str, mp3_bytes: bytes, metadata: dict[str, str]) -> bytes:
    """为 MP3 写入 ID3 元数据（流复制，失败则返回原字节）。"""
    tags = {k: v for k, v in metadata.items() if v and str(v).strip()}
    if not tags:
        return mp3_bytes
    with tempfile.TemporaryDirectory(prefix="fyv_clip_id3_") as td:
        td_path = Path(td)
        src = td_path / "in.mp3"
        dst = td_path / "out.mp3"
        src.write_bytes(mp3_bytes)
        cmd: list[str | Path] = [
            ffmpeg_bin,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(src),
            "-map_metadata",
            "-1",
            "-c",
            "copy",
        ]
        key_map = {
            "title": "title",
            "artist": "artist",
            "album": "album",
            "genre": "genre",
            "comment": "comment",
        }
        for sk, dk in key_map.items():
            val = tags.get(sk)
            if val:
                cmd.extend(["-metadata", f"{dk}={val}"])
        cmd.append(str(dst))
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=300)
        except Exception:
            logger.warning("clip export id3 copy failed, skip metadata")
            return mp3_bytes
        if not dst.is_file() or dst.stat().st_size < 32:
            return mp3_bytes
        return dst.read_bytes()


def export_clip_mp3_from_bytes(
    *,
    audio_bytes: bytes,
    normalized: dict[str, Any],
    excluded_word_ids: set[str],
    merge_gap_ms: int = 120,
    long_pause_ms: int = 0,
    long_pause_cap_ms: int = 500,
    loudnorm_i_lufs: float | None = None,
    loudnorm_tp: float | None = None,
    loudnorm_lra: float | None = None,
    skip_loudnorm: bool = False,
    segment_lame_q: int = 4,
    final_lame_q: int = 2,
    range_start_ms: int | None = None,
    range_end_ms: int | None = None,
    metadata: dict[str, str] | None = None,
) -> bytes:
    """
    将未排除的词按时间合并后切段再编码为单轨 MP3；可选词间桥接上限、分段淡入淡出、loudnorm。
    切段阶段使用单次（或分批）ffmpeg filter_complex（atrim + concat），避免逐段起子进程。
    依赖系统 PATH 中的 ffmpeg（需 libavfilter loudnorm）。
    """
    kept = _kept_words_sorted(normalized, excluded_word_ids)
    kept = _clip_kept_to_time_range(kept, range_start_ms, range_end_ms)
    if not kept:
        raise RuntimeError("没有可导出的语音片段（可能已删除全部词或时间范围无内容）")

    merge_gap_ms = max(0, int(merge_gap_ms))
    max_bridge_ms = _read_int_env("CLIP_EXPORT_MAX_BRIDGE_MS", 420)
    word_chain_max = _read_int_env("CLIP_EXPORT_WORD_CHAIN_MAX", 180)
    afade_ms = _read_int_env("CLIP_EXPORT_AFADE_MS", 8)
    if loudnorm_i_lufs is not None and math.isfinite(float(loudnorm_i_lufs)):
        i_lufs = max(-24.0, min(-10.0, float(loudnorm_i_lufs)))
    else:
        i_lufs = _read_float_env("CLIP_EXPORT_LOUDNORM_I", -16.0)
    if loudnorm_tp is not None and math.isfinite(float(loudnorm_tp)):
        tp = max(-3.0, min(0.0, float(loudnorm_tp)))
    else:
        tp = _read_float_env("CLIP_EXPORT_LOUDNORM_TP", -1.5)
    if loudnorm_lra is not None and math.isfinite(float(loudnorm_lra)):
        lra = max(1.0, min(20.0, float(loudnorm_lra)))
    else:
        lra = _read_float_env("CLIP_EXPORT_LOUDNORM_LRA", 11.0)
    skip_env = (os.getenv("CLIP_EXPORT_SKIP_LOUDNORM") or "").strip() in ("1", "true", "yes")
    do_skip_loudnorm = bool(skip_loudnorm) or skip_env

    seg_q = max(0, min(9, int(segment_lame_q)))
    fin_q = max(0, min(9, int(final_lame_q)))

    use_word_chain = max_bridge_ms > 0 and word_chain_max > 0 and len(kept) <= word_chain_max

    ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"
    with tempfile.TemporaryDirectory(prefix="fyv_clip_export_") as td:
        td_path = Path(td)
        src = td_path / "source.bin"
        src.write_bytes(audio_bytes)
        inp = str(src)

        if use_word_chain:
            raw_concat = _export_word_chain_with_bridges(
                ffmpeg_bin,
                td_path,
                inp,
                kept,
                max_bridge_ms=max_bridge_ms,
                afade_ms=afade_ms,
                long_pause_ms=max(0, int(long_pause_ms)),
                long_pause_cap_ms=max(50, min(5000, int(long_pause_cap_ms))),
                segment_lame_q=seg_q,
            )
        else:
            segs = _merge_segments(kept, gap_ms=merge_gap_ms)
            if not segs:
                raise RuntimeError("没有可导出的语音片段（可能已删除全部词）")
            segments = [(s_ms, max(50, e_ms - s_ms)) for s_ms, e_ms in segs]
            raw_concat = td_path / "seg_raw.mp3"
            _export_segments_filter_concat(
                ffmpeg_bin,
                td_path,
                inp,
                segments,
                afade_ms,
                segment_lame_q=seg_q,
                out_mp3=raw_concat,
            )

        if do_skip_loudnorm:
            out_b = raw_concat.read_bytes()
        else:
            normed = td_path / "out_loudnorm.mp3"
            _loudnorm_mp3(ffmpeg_bin, raw_concat, normed, i_lufs=i_lufs, tp=tp, lra=lra, lame_q=fin_q)
            out_b = normed.read_bytes()
        meta = metadata or {}
        return _tag_mp3_metadata(ffmpeg_bin, out_b, meta)

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


_SENTENCE_END_CHARS = frozenset("。！？；.!?…")


def _word_text(w: dict[str, Any]) -> str:
    return str(w.get("text") or w.get("word") or "").strip()


def _text_ends_sentence(text: str) -> bool:
    t = text.strip()
    return bool(t) and t[-1] in _SENTENCE_END_CHARS


def _gap_overlaps_silence(gap_start_ms: int, gap_end_ms: int, silence_regions: list[tuple[int, int]]) -> bool:
    if gap_end_ms <= gap_start_ms:
        return False
    mid = (gap_start_ms + gap_end_ms) // 2
    for rs, re in silence_regions:
        if rs <= mid <= re:
            return True
        if not (re <= gap_start_ms or rs >= gap_end_ms):
            return True
    return False


def _merge_phrase_spans(
    kept: list[dict[str, Any]],
    *,
    merge_gap_ms: int,
    split_gap_ms: int,
    punct_gap_ms: int,
    silence_regions: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    """
    编辑粒度为词，拼接粒度为短语/句：相邻保留词合并为 span，在长间隔、静音区、句末标点处切开。
    """
    if not kept:
        return []
    merge_gap_ms = max(0, int(merge_gap_ms))
    split_gap_ms = max(merge_gap_ms + 1, int(split_gap_ms))
    punct_gap_ms = max(0, int(punct_gap_ms))
    spans: list[tuple[int, int]] = []
    cur_s: int | None = None
    cur_e: int | None = None
    prev_word: dict[str, Any] | None = None

    for w in kept:
        try:
            s = int(w.get("s_ms", 0))
            e = int(w.get("e_ms", s))
        except (TypeError, ValueError):
            continue
        if e <= s:
            continue
        if cur_s is None:
            cur_s, cur_e, prev_word = s, e, w
            continue
        gap = max(0, s - int(cur_e))
        split = False
        if gap >= split_gap_ms:
            split = True
        elif silence_regions and _gap_overlaps_silence(int(cur_e), s, silence_regions):
            split = True
        elif prev_word and _text_ends_sentence(_word_text(prev_word)) and gap >= punct_gap_ms:
            split = True
        elif gap > merge_gap_ms:
            split = True
        if split:
            spans.append((int(cur_s), int(cur_e)))
            cur_s, cur_e, prev_word = s, e, w
        else:
            cur_e = max(int(cur_e), e)
            prev_word = w
    if cur_s is not None and cur_e is not None:
        spans.append((int(cur_s), int(cur_e)))
    return spans


def _phrase_segments_for_export(
    phrase_spans: list[tuple[int, int]],
    *,
    long_pause_ms: int,
    long_pause_cap_ms: int,
    min_bridge_ms: int,
    silence_cut_ranges: list[tuple[int, int, int]] | None = None,
) -> list[tuple[int, int]]:
    """
    短语 span 转为 (起点 ms, 时长 ms)；短语之间保留短桥接（环境声/自然间隙），长停顿按 cap 保留。
    """
    if not phrase_spans:
        return []
    min_bridge_ms = max(0, int(min_bridge_ms))
    long_pause_ms = max(0, int(long_pause_ms))
    long_pause_cap_ms = max(30, int(long_pause_cap_ms))
    out: list[tuple[int, int]] = []
    for i, (s, e) in enumerate(phrase_spans):
        dur = max(30, int(e) - int(s))
        out.append((int(s), dur))
        if i >= len(phrase_spans) - 1:
            break
        ns, _ = phrase_spans[i + 1]
        gap = _effective_gap_after_silence_cuts(int(e), int(ns), silence_cut_ranges)
        if gap <= 0:
            continue
        if long_pause_ms > 0 and gap >= long_pause_ms:
            bridge = min(gap, long_pause_cap_ms)
        else:
            bridge = min(gap, max(min_bridge_ms, 60))
        if bridge >= 30:
            out.append((int(e), bridge))
    return out


def _effective_gap_after_silence_cuts(
    gap_start_ms: int,
    gap_end_ms: int,
    silence_cut_ranges: list[tuple[int, int, int]] | None,
) -> int:
    gap = max(0, int(gap_end_ms) - int(gap_start_ms))
    if not silence_cut_ranges or gap <= 0:
        return gap
    cut_ms = 0
    for rs, re, cap_ms in silence_cut_ranges:
        ov = min(int(gap_end_ms), int(re)) - max(int(gap_start_ms), int(rs))
        if ov > 0:
            cut_ms += max(0, ov - max(0, int(cap_ms)))
    return max(0, gap - cut_ms)


def _pick_room_tone_slice(
    silence_regions: list[tuple[int, int]],
    *,
    min_ms: int = 400,
) -> tuple[int, int]:
    """从静音区选取一段 room tone 采样（起点 ms, 时长 ms）。"""
    best: tuple[int, int] | None = None
    for rs, re in silence_regions:
        dur = int(re) - int(rs)
        if dur < min_ms:
            continue
        if best is None or dur > best[1]:
            best = (int(rs), min(dur, 1200))
    return best if best else (0, 0)


def silence_regions_from_analysis(raw: Any) -> list[tuple[int, int]]:
    """解析工程 silence_analysis JSON 为 [(start_ms, end_ms), ...]。"""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return []
    if not isinstance(raw, dict):
        return []
    segs = raw.get("segments")
    if not isinstance(segs, list):
        return []
    out: list[tuple[int, int]] = []
    for it in segs:
        if not isinstance(it, dict):
            continue
        try:
            s = int(it.get("start_ms"))
            e = int(it.get("end_ms"))
        except (TypeError, ValueError):
            continue
        if e > s:
            out.append((s, e))
    out.sort(key=lambda x: x[0])
    return out


def _build_acrossfade_filter_script(segments: list[tuple[int, int]], crossfade_ms: int) -> str:
    """短语段 atrim + acrossfade 链（PCM），单段时不 crossfade。"""
    if not segments:
        raise RuntimeError("filter_complex：无分段")
    crossfade_ms = max(5, min(80, int(crossfade_ms)))
    branches: list[str] = []
    labels: list[str] = []
    for idx, (s_ms, dur_ms) in enumerate(segments):
        dur_ms = max(30, int(dur_ms))
        s_sec = s_ms / 1000.0
        d_sec = dur_ms / 1000.0
        lab = f"s{idx}"
        branches.append(f"[0:a]atrim=start={s_sec:.6f}:duration={d_sec:.6f},asetpts=PTS-STARTPTS[{lab}]")
        labels.append(f"[{lab}]")
    if len(labels) == 1:
        branches[-1] = branches[-1].replace(labels[0], "[out]")
        return ";".join(branches)
    cf_sec = crossfade_ms / 1000.0
    chain = labels[0]
    for i in range(1, len(labels)):
        out_lab = "out" if i == len(labels) - 1 else f"x{i}"
        branches.append(f"{chain}{labels[i]}acrossfade=d={cf_sec:.4f}:c1=tri:c2=tri[{out_lab}]")
        chain = f"[{out_lab}]"
    return ";".join(branches)


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
    「一键响度」修音目标 I（LUFS）；工程列 repair_loudness_i_lufs 优先。
    导出成片不再调用；保留供 clip_audio_repair 使用。
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


def _decode_source_to_pcm_wav(ffmpeg_bin: str, inp: str | Path, out_wav: Path) -> None:
    """将任意源音频解码为 48kHz PCM WAV，供切分/拼接全程无损中转。"""
    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(inp),
        "-vn",
        "-ar",
        "48000",
        "-c:a",
        "pcm_s16le",
        str(out_wav),
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=3600)
    if not out_wav.is_file() or out_wav.stat().st_size < 44:
        raise RuntimeError("源音频解码为 PCM 失败")


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
    silence_cut_ranges: list[tuple[int, int, int]] | None = None,
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
        if silence_cut_ranges:
            cut_ms = 0
            for rs, re, cap_ms in silence_cut_ranges:
                ov = min(ns, re) - max(e, rs)
                if ov > 0:
                    cut_ms += max(0, ov - max(0, cap_ms))
            if cut_ms > 0:
                gap = max(0, gap - cut_ms)
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


def _run_filter_complex_script_to_wav(
    ffmpeg_bin: str,
    inp: str,
    out_path: Path,
    script_path: Path,
) -> None:
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
        "pcm_s16le",
        str(out_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=3600)
    if not out_path.is_file() or out_path.stat().st_size < 44:
        raise RuntimeError("ffmpeg filter_complex 未生成有效 WAV")


def _export_segments_filter_concat(
    ffmpeg_bin: str,
    td_path: Path,
    inp: str,
    segments: list[tuple[int, int]],
    afade_ms: int,
    *,
    out_wav: Path,
) -> None:
    """
    从 PCM 源一次性切出多段并无损 concat 为单轨 WAV；段数过多时分批 WAV 再 concat。
    """
    if not segments:
        raise RuntimeError("无分段可导出")
    batch_cap = _read_filter_batch_max()
    if batch_cap == 0 or len(segments) <= batch_cap:
        script_path = td_path / "fc_export.txt"
        script_path.write_text(_build_atrim_concat_filter_script(segments, afade_ms), encoding="utf-8")
        _run_filter_complex_script_to_wav(ffmpeg_bin, inp, out_wav, script_path)
        return

    chunk_paths: list[Path] = []
    for b_start in range(0, len(segments), batch_cap):
        batch = segments[b_start : b_start + batch_cap]
        script_path = td_path / f"fc_export_{b_start}.txt"
        script_path.write_text(_build_atrim_concat_filter_script(batch, afade_ms), encoding="utf-8")
        chunk = td_path / f"fc_chunk_{b_start:05d}.wav"
        _run_filter_complex_script_to_wav(ffmpeg_bin, inp, chunk, script_path)
        chunk_paths.append(chunk)
    _concat_demuxer_wav(ffmpeg_bin, td_path, chunk_paths, out_wav)


def _concat_demuxer_wav(ffmpeg_bin: str, td_path: Path, parts: list[Path], out_wav: Path) -> None:
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
        str(out_wav),
    ]
    subprocess.run(cmd2, check=True, cwd=str(td_path), capture_output=True, timeout=600)
    if not out_wav.is_file():
        raise RuntimeError("ffmpeg WAV 拼接失败")


def _encode_pcm_wav_to_mp3(ffmpeg_bin: str, wav: Path, out_mp3: Path, *, lame_q: int) -> None:
    """终稿唯一一次有损编码。"""
    q = max(0, min(9, int(lame_q)))
    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(wav),
        "-c:a",
        "libmp3lame",
        "-q:a",
        str(q),
        str(out_mp3),
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=900)
    if not out_mp3.is_file() or out_mp3.stat().st_size < 32:
        raise RuntimeError("MP3 终稿编码失败")


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


def _export_phrase_acrossfade(
    ffmpeg_bin: str,
    td_path: Path,
    inp: str,
    segments: list[tuple[int, int]],
    crossfade_ms: int,
    *,
    out_wav: Path,
) -> None:
    """短语段 atrim + acrossfade 链，输出 PCM WAV；段数过多时分批再 concat。"""
    if not segments:
        raise RuntimeError("无分段可导出")
    batch_cap = _read_filter_batch_max()
    if batch_cap == 0 or len(segments) <= batch_cap:
        script_path = td_path / "fc_phrase.txt"
        script_path.write_text(_build_acrossfade_filter_script(segments, crossfade_ms), encoding="utf-8")
        _run_filter_complex_script_to_wav(ffmpeg_bin, inp, out_wav, script_path)
        return
    chunk_paths: list[Path] = []
    for b_start in range(0, len(segments), batch_cap):
        batch = segments[b_start : b_start + batch_cap]
        script_path = td_path / f"fc_phrase_{b_start}.txt"
        script_path.write_text(_build_acrossfade_filter_script(batch, crossfade_ms), encoding="utf-8")
        chunk = td_path / f"phrase_chunk_{b_start:05d}.wav"
        _run_filter_complex_script_to_wav(ffmpeg_bin, inp, chunk, script_path)
        chunk_paths.append(chunk)
    _concat_demuxer_wav(ffmpeg_bin, td_path, chunk_paths, out_wav)


def _mix_room_tone_under(
    ffmpeg_bin: str,
    td_path: Path,
    main_wav: Path,
    source_inp: str,
    silence_regions: list[tuple[int, int]],
    *,
    volume: float = 0.08,
) -> Path:
    """从静音区抽取 room tone，低音量垫在全轨下方以维持环境声连续感。"""
    rt_start, rt_dur = _pick_room_tone_slice(silence_regions)
    if rt_dur < 400:
        return main_wav
    vol = max(0.02, min(0.25, float(volume)))
    out_wav = td_path / "phrase_with_room_tone.wav"
    s_sec = rt_start / 1000.0
    d_sec = rt_dur / 1000.0
    filt = (
        f"[1:a]atrim=start={s_sec:.6f}:duration={d_sec:.6f},asetpts=PTS-STARTPTS,"
        f"aloop=loop=-1:size=2e+09,volume={vol:.4f}[rt];"
        f"[0:a][rt]amix=inputs=2:duration=first:dropout_transition=0[out]"
    )
    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(main_wav),
        "-i",
        str(source_inp),
        "-filter_complex",
        filt,
        "-map",
        "[out]",
        "-c:a",
        "pcm_s16le",
        str(out_wav),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=3600)
    except Exception:
        logger.warning("clip export room tone mix failed, skip bed")
        return main_wav
    if not out_wav.is_file() or out_wav.stat().st_size < 44:
        return main_wav
    return out_wav


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
    skip_loudnorm: bool = True,
    segment_lame_q: int = 4,
    final_lame_q: int = 2,
    range_start_ms: int | None = None,
    range_end_ms: int | None = None,
    silence_cut_ranges: list[tuple[int, int, int]] | None = None,
    silence_regions: list[tuple[int, int]] | None = None,
    duck_ranges: list[tuple[int, int]] | None = None,
    metadata: dict[str, str] | None = None,
) -> bytes:
    """
    将未排除的词按短语/句合并后 acrossfade 拼接，PCM 中转，终稿单次 MP3 编码。
    loudnorm 默认关闭；响度归一请使用「一键响度」修音后再导出。
    """
    kept = _kept_words_sorted(normalized, excluded_word_ids)
    kept = _clip_kept_to_time_range(kept, range_start_ms, range_end_ms)
    if not kept:
        raise RuntimeError("没有可导出的语音片段（可能已删除全部词或时间范围无内容）")

    phrase_merge_gap = _read_int_env("CLIP_EXPORT_PHRASE_MERGE_GAP_MS", 320)
    phrase_split_gap = _read_int_env("CLIP_EXPORT_PHRASE_SPLIT_GAP_MS", 700)
    punct_gap_ms = _read_int_env("CLIP_EXPORT_PHRASE_PUNCT_GAP_MS", 150)
    min_bridge_ms = _read_int_env("CLIP_EXPORT_PHRASE_MIN_BRIDGE_MS", 80)
    crossfade_ms = _read_int_env("CLIP_EXPORT_ACROSSFADE_MS", 25)
    room_tone_on = (os.getenv("CLIP_EXPORT_ROOM_TONE") or "1").strip() not in ("0", "false", "no")
    try:
        room_tone_vol = float(os.getenv("CLIP_EXPORT_ROOM_TONE_VOL") or "0.08")
    except (TypeError, ValueError):
        room_tone_vol = 0.08

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

    fin_q = max(0, min(9, int(final_lame_q)))
    regions = list(silence_regions or [])

    ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"
    with tempfile.TemporaryDirectory(prefix="fyv_clip_export_") as td:
        td_path = Path(td)
        src = td_path / "source.bin"
        src.write_bytes(audio_bytes)
        src_inp = str(src)
        if duck_ranges:
            dr = [(max(0, int(s)), max(0, int(e))) for s, e in duck_ranges if int(e) > int(s)]
            if dr:
                ducked = td_path / "source_duck.wav"
                ffmpeg_duck = shutil.which("ffmpeg") or "ffmpeg"
                max_events = 80
                chains: list[str] = []
                for idx, (s, e) in enumerate(dr[:max_events]):
                    chains.append(f"volume=0.28:enable='between(t,{s/1000.0:.3f},{e/1000.0:.3f})'")
                filt = ",".join(chains)
                if filt:
                    cmd_duck = [
                        ffmpeg_duck,
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-y",
                        "-i",
                        str(src),
                        "-af",
                        filt,
                        "-ac",
                        "1",
                        "-ar",
                        "48000",
                        "-c:a",
                        "pcm_s16le",
                        str(ducked),
                    ]
                    try:
                        subprocess.run(cmd_duck, check=True, capture_output=True, timeout=900)
                        if ducked.is_file() and ducked.stat().st_size > 44:
                            src_inp = str(ducked)
                    except Exception:
                        logger.warning("clip export duck preprocess failed, fallback raw source")

        pcm_src = td_path / "source_pcm.wav"
        if src_inp.endswith(".wav") and Path(src_inp).is_file():
            pcm_src = Path(src_inp)
        else:
            _decode_source_to_pcm_wav(ffmpeg_bin, src_inp, pcm_src)
        inp = str(pcm_src)

        phrase_spans = _merge_phrase_spans(
            kept,
            merge_gap_ms=phrase_merge_gap,
            split_gap_ms=phrase_split_gap,
            punct_gap_ms=punct_gap_ms,
            silence_regions=regions,
        )
        if not phrase_spans:
            raise RuntimeError("没有可导出的语音片段（可能已删除全部词）")
        segments = _phrase_segments_for_export(
            phrase_spans,
            long_pause_ms=max(0, int(long_pause_ms)),
            long_pause_cap_ms=max(50, min(5000, int(long_pause_cap_ms))),
            min_bridge_ms=min_bridge_ms,
            silence_cut_ranges=silence_cut_ranges,
        )
        raw_concat = td_path / "phrase_raw.wav"
        _export_phrase_acrossfade(
            ffmpeg_bin,
            td_path,
            inp,
            segments,
            crossfade_ms,
            out_wav=raw_concat,
        )
        if room_tone_on and regions:
            mixed = _mix_room_tone_under(
                ffmpeg_bin,
                td_path,
                raw_concat,
                inp,
                regions,
                volume=room_tone_vol,
            )
            raw_concat = mixed

        out_mp3 = td_path / "export_final.mp3"
        if do_skip_loudnorm:
            _encode_pcm_wav_to_mp3(ffmpeg_bin, raw_concat, out_mp3, lame_q=fin_q)
        else:
            tmp_mp3 = td_path / "pre_loudnorm.mp3"
            _encode_pcm_wav_to_mp3(ffmpeg_bin, raw_concat, tmp_mp3, lame_q=fin_q)
            _loudnorm_mp3(ffmpeg_bin, tmp_mp3, out_mp3, i_lufs=i_lufs, tp=tp, lra=lra, lame_q=fin_q)
        out_b = out_mp3.read_bytes()
        meta = metadata or {}
        return _tag_mp3_metadata(ffmpeg_bin, out_b, meta)

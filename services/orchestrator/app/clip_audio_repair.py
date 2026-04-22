"""主素材离线修音：ffmpeg 通用链（底噪/回声缓解 + EBU R128 响度归一）。"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


def _ffmpeg_bin() -> str:
    return shutil.which("ffmpeg") or "ffmpeg"


def _read_env_profile(default: str = "standard") -> str:
    raw = (os.getenv("CLIP_REPAIR_AMBIENT_PROFILE") or default).strip().lower()
    if raw in ("light", "standard", "strong"):
        return raw
    logger.warning("unknown CLIP_REPAIR_AMBIENT_PROFILE=%r, using standard", raw)
    return "standard"


def _voice_enhance_afilter_segment() -> str:
    """
    降噪后轻量「人声存在感」：窄带提中高频 + 轻 RMS 压缩，再接限幅更不易削波。
    关闭：CLIP_REPAIR_VOICE_ENHANCE=0|false|no|off
    """
    raw = (os.getenv("CLIP_REPAIR_VOICE_ENHANCE") or "1").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return ""
    return (
        "equalizer=f=2600:width_type=o:width=1.1:g=1.3,"
        "equalizer=f=140:width_type=o:width=1:g=-0.9,"
        "acompressor=threshold=0.16:ratio=2.2:attack=18:release=220:makeup=1.05:knee=2.5:link=average:detection=rms"
    )


def _ambient_afilter_chain() -> str:
    """
    播客常见「轻量离线」链（仍非 iZotope RX 级）：
    - highpass ~80–100 Hz：去空调/交通低频隆隆
    - afftdn + track_noise：随底噪变化自适应谱减，比固定门限更贴近广播习惯
    - （可选）人声轻增强：提存在感 + 轻压缩
    - alimiter：抑制尖峰、避免降噪后偶发 overs

    档位：light（干净录音少动）、standard（默认）、strong（明显底噪，artifact 风险更高）。
    全量覆盖：CLIP_REPAIR_AMBIENT_AFILTER 可写整条 -af（高级运维）。
    """
    override = (os.getenv("CLIP_REPAIR_AMBIENT_AFILTER") or "").strip()
    if override:
        return override
    prof = _read_env_profile()
    if prof == "light":
        core = "highpass=f=80,afftdn=nf=-28:nr=6:tn=1:ad=0.45"
    elif prof == "strong":
        core = "highpass=f=100,afftdn=nf=-22:nr=12:tn=1:ad=0.55"
    else:
        # standard：略弱于旧版固定 NR，打开 tn，减轻「金属声」同时仍压稳态噪声
        core = "highpass=f=80,afftdn=nf=-25:nr=9:tn=1:ad=0.55"
    voice = _voice_enhance_afilter_segment()
    lim = "alimiter=limit=0.97:attack=5:release=50"
    if voice:
        return f"{core},{voice},{lim}"
    return f"{core},{lim}"


def repair_ambient_to_mp3(inp: Path, out_mp3: Path) -> None:
    filt = _ambient_afilter_chain()
    cmd = [
        _ffmpeg_bin(),
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
        "3",
        str(out_mp3),
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=3600)
    if not out_mp3.is_file() or out_mp3.stat().st_size < 32:
        raise RuntimeError("环境音处理未生成有效音频")


def repair_loudnorm_to_mp3(inp: Path, out_mp3: Path, *, i_lufs: float = -16.0, tp: float = -1.5, lra: float = 11.0) -> None:
    """
    主素材响度归一：默认同 EBU R128 **两遍 loudnorm**（测量 + linear 二遍），真峰值与听感更稳。
    回退单遍：环境变量 CLIP_REPAIR_LOUDNORM_SINGLE_PASS=1。
    """
    from .clip_export import _loudnorm_mp3, _loudnorm_mp3_two_pass

    fb = _ffmpeg_bin()
    single = (os.getenv("CLIP_REPAIR_LOUDNORM_SINGLE_PASS") or "").strip().lower() in ("1", "true", "yes")
    if single:
        _loudnorm_mp3(fb, inp, out_mp3, i_lufs=i_lufs, tp=tp, lra=lra)
    else:
        _loudnorm_mp3_two_pass(fb, inp, out_mp3, i_lufs=i_lufs, tp=tp, lra=lra)
    if not out_mp3.is_file() or out_mp3.stat().st_size < 32:
        raise RuntimeError("响度标准化未生成有效音频")


def sniff_suffix_from_filename(name: str) -> str:
    n = (name or "").strip().lower()
    for suf in (".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".webm"):
        if n.endswith(suf):
            return suf
    return ".bin"


def _volumedetect_mean_volume_db(ffmpeg_bin: str, path: Path) -> float:
    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-nostats",
        "-i",
        str(path),
        "-af",
        "volumedetect",
        "-f",
        "null",
        "-",
    ]
    r = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=3600)
    m = re.search(r"mean_volume:\s*(-?[0-9]+\.?[0-9]*)\s*dB", r.stderr or "", re.I)
    if not m:
        raise RuntimeError("volumedetect 未解析 mean_volume")
    return float(m.group(1))


def _dual_balance_max_db() -> float:
    raw = (os.getenv("CLIP_REPAIR_DUAL_BALANCE_MAX_DB") or "12").strip()
    try:
        v = float(raw)
    except ValueError:
        return 12.0
    return max(1.0, min(24.0, v))


def repair_dual_stereo_balance_to_mp3(inp: Path, out_mp3: Path) -> None:
    """
    立体声双轨（左/右各一人常见）：分别测左右 mean_volume，向中间值对称补偿 dB，再拼回 stereo。
    单声道或非 2 声道会抛错。最大补偿由 CLIP_REPAIR_DUAL_BALANCE_MAX_DB（默认 12）限制。
    """
    from .clip_audio_merge import ffprobe_first_audio_stream

    fb = _ffmpeg_bin()
    n_ch, _layout = ffprobe_first_audio_stream(inp)
    if n_ch != 2:
        raise RuntimeError("需要立体声双声道素材（左/右各一轨常见）；当前声道数不为 2。")

    max_adj = _dual_balance_max_db()
    with tempfile.TemporaryDirectory(prefix="fyv_dualbal_") as td:
        td_path = Path(td)
        left_wav = td_path / "L.wav"
        right_wav = td_path / "R.wav"
        split_cmd = [
            fb,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(inp),
            "-filter_complex",
            "[0:a]channelsplit[L][R]",
            "-map",
            "[L]",
            str(left_wav),
            "-map",
            "[R]",
            str(right_wav),
        ]
        try:
            subprocess.run(split_cmd, check=True, capture_output=True, text=True, timeout=3600)
        except subprocess.CalledProcessError as e:
            err = (e.stderr or e.stdout or "").strip()[:800]
            raise RuntimeError(f"声道拆分失败: {err}") from e

        ml = _volumedetect_mean_volume_db(fb, left_wav)
        mr = _volumedetect_mean_volume_db(fb, right_wav)
        mid = (ml + mr) / 2.0
        adj_l = max(-max_adj, min(max_adj, mid - ml))
        adj_r = max(-max_adj, min(max_adj, mid - mr))
        logger.info("dual_balance mean_db L=%.2f R=%.2f adj_L=%.2f adj_R=%.2f", ml, mr, adj_l, adj_r)

        filt = (
            f"[0:a]channelsplit[L][R];"
            f"[L]volume={adj_l:.4f}dB[Lg];[R]volume={adj_r:.4f}dB[Rg];"
            f"[Lg][Rg]join=inputs=2:channel_layout=stereo[out]"
        )
        out_cmd = [
            fb,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(inp),
            "-filter_complex",
            filt,
            "-map",
            "[out]",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "3",
            str(out_mp3),
        ]
        try:
            subprocess.run(out_cmd, check=True, capture_output=True, text=True, timeout=3600)
        except subprocess.CalledProcessError as e:
            err = (e.stderr or e.stdout or "").strip()[:800]
            raise RuntimeError(f"双轨平衡编码失败: {err}") from e

    if not out_mp3.is_file() or out_mp3.stat().st_size < 32:
        raise RuntimeError("双轨自动平衡未生成有效音频")

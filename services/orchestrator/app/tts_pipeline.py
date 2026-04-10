"""
Extended TTS: single/dual dialogue, optional intro/outro, deterministic polish (sanitize).
Used by ai worker; requires pydub + app.fyv_shared.audio_utils + minimax_client.
"""
from __future__ import annotations

import io
import math
import os
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from .audio_mix import _resolve_bgm_path
from .provider_router import (
    default_podcast_voice_ids,
    generate_cover_image,
    polish_tts_text,
    script_provider,
    synthesize_tts,
)

try:
    from app.fyv_shared.config import TTS_ASYNC_TEXT_MAX_CHARS as TTS_BODY_MAX_CHARS
    from app.fyv_shared.config import TTS_SYNC_TEXT_MAX_CHARS as TTS_CHUNK_CEILING_CHARS
except ImportError:
    TTS_BODY_MAX_CHARS = 50_000
    TTS_CHUNK_CEILING_CHARS = 10_000
TTS_INTRO_OUTRO_MAX = 800
# 开场+收场总长度在此阈值内且均非空时，尝试单次模型调用合并润色（失败则回退为两次独立润色）
_INTRO_OUTRO_BUNDLE_MAX_COMBINED_CHARS = 1400
# AI 润色完成后是否再跑 sanitize_for_tts；默认关闭（暂停）。需恢复时设 TTS_SANITIZE_AFTER_POLISH=1
def _tts_sanitize_after_polish_enabled() -> bool:
    raw = str(os.getenv("TTS_SANITIZE_AFTER_POLISH") or "").strip().lower()
    return raw in ("1", "true", "yes", "on")

# 与 podcast_generator 入队单句长度同量级：过长时在软标点处再切；默认偏大以减少 API 往返（≤ 同步 T2A 单段上限）
_DEFAULT_TTS_MAX_CHUNK_CHARS = 9000
# 句边界：中文句读 + 英文「.!? + 空格 + 大写」避免误切小数
_TTS_SENTENCE_SPLIT_RE = re.compile(
    r"(?<=[。！？!?；;…])\s*"
    r"|(?<=[.!?])\s+(?=[A-Z])"
)

# MiniMax T2A 停顿 <#x#>，x∈[0.01,99.99]，最多两位小数（与官方文档一致）
_TTS_PAUSE_TAG_RE = re.compile(r"<#([0-9]+(?:\.[0-9]{1,2})?|\.[0-9]{1,2})#>")
# 同步/异步文档中的语气词标签，勿被「去掉括号说明」误删
_MINIMAX_SPEECH_PAREN_TAGS = frozenset({
    "laughs",
    "chuckle",
    "coughs",
    "clear-throat",
    "groans",
    "breath",
    "pant",
    "inhale",
    "exhale",
    "gasps",
    "sniffs",
    "sighs",
    "snorts",
    "burps",
    "lip-smacking",
    "humming",
    "hissing",
    "emm",
    "sneezes",
    "whistles",
    "crying",
    "applause",
})


def _tts_pause_sub(m: re.Match[str]) -> str:
    try:
        v = float(m.group(1))
    except ValueError:
        return ""
    if not (0.01 <= v <= 99.99):
        return ""
    r = round(v, 2)
    if abs(r - int(r)) < 1e-9:
        return f"<#{int(r)}#>"
    return f"<#{r:.2f}#>"


def sanitize_for_tts(s: str) -> str:
    """
    清洗面向 TTS 的文本：保留 MiniMax 停顿 <#x#> 与官方语气词 (tag)；
    其余尖括号片段、括号内舞台说明等仍移除。
    """
    if not s:
        return ""
    t = str(s)
    t = _TTS_PAUSE_TAG_RE.sub(_tts_pause_sub, t)
    t = re.sub(r"（[^）]{0,80}）", "", t)

    def _keep_minimax_paren(pm: re.Match[str]) -> str:
        inner = (pm.group(1) or "").strip().lower()
        return pm.group(0) if inner in _MINIMAX_SPEECH_PAREN_TAGS else ""

    t = re.sub(r"\(([^)]{1,80})\)", _keep_minimax_paren, t)
    t = re.sub(r"\[[^\]]{0,80}\]", "", t)
    t = re.sub(r"\{[^}]{0,80}\}", "", t)
    t = re.sub(r"【[^】]{0,80}】", "", t)

    def _keep_pause_angle(am: re.Match[str]) -> str:
        frag = am.group(0)
        return frag if _TTS_PAUSE_TAG_RE.fullmatch(frag) else ""

    t = re.sub(r"<[^>]{0,80}>", _keep_pause_angle, t)
    t = t.replace("\r\n", "\n").replace("\r", "\n")
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    return t.strip()


# 与 podcast_generator._parse_speaker_line 一致：行首 Speaker1:/Speaker2: 仅作路由，不送入 TTS。
_SPEAKER_LINE_RE = re.compile(r"^\s*Speaker\s*([12])\s*[:：]\s*(.*)$", re.I)
_SPEAKER_LINE_LOOSE_RE = re.compile(r"^\s*S\s*([12])\s*[:：]\s*(.+)$", re.I)
# 规范化：统一为「Speaker1: 」/「Speaker2: 」（半角冒号 + 冒号后单空格），合并重复冒号
_SPEAKER_PREFIX_NORMALIZE = re.compile(
    r"^\s*(?:speaker)\s*([12])\s*[:：]+\s*(.*)$",
    re.I,
)
_SPEAKER_LOOSE_PREFIX_NORMALIZE = re.compile(
    r"^\s*S\s*([12])\s*[:：]+\s*(.*)$",
    re.I,
)
# 模型偶发「Speaker 1 正文」漏写冒号
_SPEAKER_MISSING_COLON = re.compile(
    r"^\s*Speaker\s*([12])\s+([^:：\s].*)$",
    re.I,
)


def normalize_dialogue_speaker_lines(text: str) -> str:
    """
    将双人稿中行首 Speaker 标记规范为 Speaker1: / Speaker2:（半角冒号），
    避免全角冒号、重复冒号、大小写混杂等导致解析失败或 TTS 误读标签。
    幂等：已规范行保持不变。
    """
    if not (text or "").strip():
        return text or ""
    out: list[str] = []
    for raw in (text or "").split("\n"):
        line = raw.rstrip("\r")
        stripped = line.strip()
        if not stripped:
            out.append("")
            continue
        m = _SPEAKER_PREFIX_NORMALIZE.match(stripped)
        if not m:
            m = _SPEAKER_LOOSE_PREFIX_NORMALIZE.match(stripped)
        if not m:
            m = _SPEAKER_MISSING_COLON.match(stripped)
        if m:
            sp = m.group(1)
            body = (m.group(2) or "").strip()
            out.append(f"Speaker{sp}: {body}" if body else f"Speaker{sp}:")
        else:
            out.append(stripped)
    return "\n".join(out)


def dialogue_speaker_format_issues(text: str) -> list[str]:
    """
    规范化之后仍不像标准 Speaker 行的行首提示（用于任务日志，非致命）。
    标准行：行首为 Speaker1: / Speaker2:（半角冒号）。
    不误报：正文以「Speaker1」指代等开头但非标签行——仅当 Speaker+数字后未紧跟冒号时提示。
    """
    normalized = normalize_dialogue_speaker_lines(text)
    issues: list[str] = []
    bad = re.compile(r"(?i)^\s*Speaker\s*[12](?!\s*[:：])")
    for i, line in enumerate(normalized.split("\n"), 1):
        s = line.strip()
        if not s:
            continue
        if bad.search(s):
            issues.append(f"第{i}行 Speaker 标记后缺少冒号或格式异常: {s[:80]}{'…' if len(s) > 80 else ''}")
    return issues


def _strip_speaker_prefixes_line_by_line(raw: str) -> str:
    """整段无标准行首时，逐行去掉 Speaker 标签，再交给单人 TTS（避免朗读 Speaker1）。"""
    out: list[str] = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        m = _SPEAKER_LINE_RE.match(line)
        if m:
            body = (m.group(2) or "").strip()
            if body:
                out.append(body)
            continue
        m2 = _SPEAKER_LINE_LOOSE_RE.match(line)
        if m2:
            body = (m2.group(2) or "").strip()
            if body:
                out.append(body)
            continue
        out.append(line)
    return "\n".join(out)


def split_text_into_tts_sentence_chunks(
    text: str, *, max_chunk_chars: int = _DEFAULT_TTS_MAX_CHUNK_CHARS
) -> list[str]:
    """
    对齐 podcast_generator 流式入队粒度：
    - 空行分段后，段内按单行换行再切（对应 _is_complete_sentence 里 buffer.endswith('\\n')）；
    - 每行内再按句末标点切分；过长无标点时在软标点或硬长度处切开。
    """
    t = (text or "").strip()
    if not t:
        return []
    t = re.sub(r"\r\n|\r", "\n", t)
    out: list[str] = []
    for para in re.split(r"\n\s*\n+", t):
        p = para.strip()
        if not p:
            continue
        for line in p.split("\n"):
            line = line.strip()
            if not line:
                continue
            raw_parts = [x for x in _TTS_SENTENCE_SPLIT_RE.split(line) if x and x.strip()]
            if not raw_parts:
                raw_parts = [line]
            for part in raw_parts:
                s = (part or "").strip()
                if not s:
                    continue
                out.extend(_split_oversized_tts_chunk(s, max_chunk_chars=max_chunk_chars))
    if not out:
        return [t]
    return out


def _split_oversized_tts_chunk(chunk: str, *, max_chunk_chars: int) -> list[str]:
    if len(chunk) <= max_chunk_chars:
        return [chunk]
    pieces: list[str] = []
    buf = chunk
    soft = "，,、：:"
    while len(buf) > max_chunk_chars:
        window = buf[:max_chunk_chars]
        cut = -1
        for i in range(len(window) - 1, max(0, len(window) // 3), -1):
            if window[i] in soft:
                cut = i + 1
                break
        if cut > 0:
            piece = buf[:cut].strip()
            buf = buf[cut:].lstrip()
            if piece:
                pieces.append(piece)
        else:
            piece = buf[:max_chunk_chars].strip()
            buf = buf[max_chunk_chars:].lstrip()
            if piece:
                pieces.append(piece)
    if buf.strip():
        pieces.append(buf.strip())
    return pieces if pieces else [chunk[:max_chunk_chars].strip()]


def _tts_segment_text_cleanup(text: str) -> str:
    """合成前最后清理：去掉行首/误写入的 Speaker 标签，避免被读成英文。"""
    t = (text or "").strip()
    if not t:
        return t
    lines: list[str] = []
    for line in t.split("\n"):
        line = line.strip()
        if not line:
            continue
        m = _SPEAKER_LINE_RE.match(line)
        if m:
            lines.append((m.group(2) or "").strip())
        else:
            m2 = _SPEAKER_LINE_LOOSE_RE.match(line)
            if m2:
                lines.append(m2.group(2).strip())
            else:
                lines.append(line)
    t = "\n".join(x for x in lines if x)
    t = re.sub(r"(?i)\bSpeaker\s*1\b", "", t)
    t = re.sub(r"(?i)\bSpeaker\s*2\b", "", t)
    # 模型偶发「Speaker 1：」或正文内英文标签
    t = re.sub(r"(?i)Speaker\s*1\s*[:：]\s*", "", t)
    t = re.sub(r"(?i)Speaker\s*2\s*[:：]\s*", "", t)
    # 行内粘连写法 Speaker1、SPEAKER2、无空格 Speaker1： 等
    t = re.sub(r"(?i)speaker\s*[12]\s*[:：]?\s*", "", t)
    # 正文中间残留的 Speaker1/Speaker2（字母数字下划线前不截断，避免误伤英文单词）
    t = re.sub(r"(?i)speaker\s*1(?=[^a-z0-9_.]|$)", "", t)
    t = re.sub(r"(?i)speaker\s*2(?=[^a-z0-9_.]|$)", "", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def _estimate_throttle_wait_seconds(request_count: int, rpm_limit: int) -> int:
    """估算主动限速可能带来的额外等待（粗估）。"""
    n = max(0, int(request_count))
    rpm = max(1, int(rpm_limit))
    if n <= rpm:
        return 0
    # 例：rpm=10, n=23 -> 需要跨 3 个窗口，约 2 次窗口等待（~120s 上界）
    windows = math.ceil(n / rpm)
    return max(0, windows - 1) * 60


def _merge_dual_dialogue_segments(
    lines: list[tuple[str, str]],
    *,
    min_short_chars: int = 18,
    target_chars: int = 120,
    max_chars: int = 260,
) -> list[tuple[str, str]]:
    """
    在不改变说话人路由的前提下，合并同一 Speaker 的短段，减少 TTS 请求数。
    仅合并同说话人，避免音色错配。
    """
    if not lines:
        return []
    merged: list[tuple[str, str]] = []
    for sp, chunk in lines:
        body = (chunk or "").strip()
        if not body:
            continue
        if not merged:
            merged.append((sp, body))
            continue
        prev_sp, prev_body = merged[-1]
        can_merge = (
            sp == prev_sp
            and (len(prev_body) < target_chars or len(body) <= min_short_chars)
            and (len(prev_body) + 1 + len(body) <= max_chars)
        )
        if can_merge:
            merged[-1] = (prev_sp, f"{prev_body} {body}".strip())
        else:
            merged.append((sp, body))
    return merged


def parse_tts_dialogue_lines(text: str) -> list[tuple[str, str]]:
    raw = normalize_dialogue_speaker_lines((text or "").strip())
    if not raw:
        return []
    pat = _SPEAKER_LINE_RE
    segments: list[tuple[str, str]] = []
    current_sp = "1"
    current_parts: list[str] = []

    def flush() -> None:
        if not current_parts:
            return
        t = "\n".join(current_parts).strip()
        current_parts.clear()
        if t:
            segments.append((current_sp, t))

    for line in raw.split("\n"):
        m = pat.match(line.strip())
        if m:
            flush()
            current_sp = m.group(1)
            rest = (m.group(2) or "").strip()
            current_parts = [rest] if rest else []
        else:
            current_parts.append(line)
    flush()

    if segments:
        return segments

    loose: list[tuple[str, str]] = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        m = pat.match(line)
        if m:
            loose.append((m.group(1), (m.group(2) or "").strip()))
        else:
            m2 = _SPEAKER_LINE_LOOSE_RE.match(line)
            if m2:
                loose.append((m2.group(1), m2.group(2).strip()))
    if loose:
        return loose

    cleaned = _strip_speaker_prefixes_line_by_line(raw)
    if cleaned.strip():
        return [("1", cleaned.strip())]
    return []


def _hex_to_segment(audio_hex: str) -> Any:
    from app.fyv_shared.audio_utils import hex_to_audio_segment

    return hex_to_audio_segment(audio_hex)


def _segment_to_hex(seg: Any) -> str:
    from pydub import AudioSegment  # type: ignore

    buf = io.BytesIO()
    seg.export(buf, format="mp3")
    return buf.getvalue().hex()


def _optional_bgm_segment(payload: dict[str, Any], prefix: str) -> Any | None:
    """Optional BGM clip before/after intro/outro: {prefix}_mp3_hex (raw mp3 hex) or {prefix}_slot bgm01|bgm02."""
    from pydub import AudioSegment  # type: ignore

    hex_key = f"{prefix}_mp3_hex"
    slot_key = f"{prefix}_slot"
    hx = str(payload.get(hex_key) or "").strip()
    if hx:
        try:
            return AudioSegment.from_mp3(io.BytesIO(bytes.fromhex(hx)))
        except Exception:
            pass
    slot = str(payload.get(slot_key) or "").strip().lower()
    if slot not in ("bgm01", "bgm02"):
        return None
    path = _resolve_bgm_path(slot)
    if not path:
        return None
    try:
        seg = AudioSegment.from_wav(path)
        return seg[:60_000] if len(seg) > 60_000 else seg
    except Exception:
        return None


def run_extended_tts(
    payload: dict[str, Any],
    api_key: str | None,
    *,
    progress_hook: Callable[[int, str], None] | None = None,
) -> dict[str, Any]:
    text = str(payload.get("text") or "").strip()
    intro_text = str(payload.get("intro_text") or "").strip()
    outro_text = str(payload.get("outro_text") or "").strip()
    ai_polish = bool(payload.get("ai_polish", False))
    skip_model_polish_main = bool(payload.get("skip_model_polish_main", False))
    tts_sentence_chunks = bool(payload.get("tts_sentence_chunks", False))
    try:
        tts_max_chunk_chars = int(payload.get("tts_max_chunk_chars") or _DEFAULT_TTS_MAX_CHUNK_CHARS)
    except (TypeError, ValueError):
        tts_max_chunk_chars = _DEFAULT_TTS_MAX_CHUNK_CHARS
    # 单段不超过 TTS_SYNC_TEXT_MAX_CHARS；较长时由 minimax_client 对同步 T2A 使用 stream=true
    tts_max_chunk_chars = max(120, min(int(TTS_CHUNK_CEILING_CHARS), tts_max_chunk_chars))
    tts_mode = str(payload.get("tts_mode") or "single").strip().lower()
    if tts_mode not in ("single", "dual"):
        tts_mode = "single"

    _def_mini, _def_max = default_podcast_voice_ids()
    voice_id = str(payload.get("voice_id") or "").strip() or _def_mini
    voice_id_1 = str(payload.get("voice_id_1") or "").strip() or _def_mini
    voice_id_2 = str(payload.get("voice_id_2") or "").strip() or _def_max
    intro_voice_override = str(payload.get("intro_voice_id") or "").strip()
    outro_voice_override = str(payload.get("outro_voice_id") or "").strip()

    if intro_text and len(intro_text) > TTS_INTRO_OUTRO_MAX:
        intro_text = intro_text[:TTS_INTRO_OUTRO_MAX]
    if outro_text and len(outro_text) > TTS_INTRO_OUTRO_MAX:
        outro_text = outro_text[:TTS_INTRO_OUTRO_MAX]

    if not text and not intro_text and not outro_text:
        raise RuntimeError("文本为空")

    if tts_mode == "dual" and text:
        text = normalize_dialogue_speaker_lines(text)

    main_body = text
    if len(main_body) > TTS_BODY_MAX_CHARS:
        main_body = main_body[:TTS_BODY_MAX_CHARS]

    # 双人润色若丢掉 Speaker 行首，parse_tts_dialogue_lines 会把全文归到默认说话人 1，只听得到单人音色
    pre_polish_dual_body = main_body if tts_mode == "dual" else ""

    polished = False

    def polish_for_reading(fragment: str, *, llm_mode: str) -> str:
        """ai_polish：走 orchestrator 润色（MiniMax 支持单/双人分段）；sanitize 见 _tts_sanitize_after_polish_enabled。"""
        nonlocal polished
        t = (fragment or "").strip()
        if not t:
            return ""
        if not ai_polish:
            return t
        out = polish_tts_text(t, api_key=api_key, tts_mode=llm_mode)
        if not out.get("success"):
            raise RuntimeError(str(out.get("error") or "文本润色失败"))
        polished = True
        polished_text = str(out.get("text") or "").strip()
        if _tts_sanitize_after_polish_enabled():
            return sanitize_for_tts(polished_text)
        return polished_text

    intro_final = ""
    outro_final = ""
    if ai_polish and intro_text and outro_text:
        _combo = len(intro_text) + len(outro_text)
        if _combo <= _INTRO_OUTRO_BUNDLE_MAX_COMBINED_CHARS and script_provider() == "minimax":
            from .legacy_bridge import polish_intro_outro_bundle_for_tts

            _bor = polish_intro_outro_bundle_for_tts(intro_text, outro_text, api_key=api_key)
            if _bor.get("success"):
                _pi = str(_bor.get("intro") or "").strip()
                _po = str(_bor.get("outro") or "").strip()
                if _pi and _po:
                    intro_final = _pi
                    outro_final = _po
                    if _tts_sanitize_after_polish_enabled():
                        intro_final = sanitize_for_tts(intro_final)
                        outro_final = sanitize_for_tts(outro_final)
                    polished = True
    if ai_polish:
        if intro_text and not intro_final:
            intro_final = polish_for_reading(intro_text, llm_mode="single")
        if outro_text and not outro_final:
            outro_final = polish_for_reading(outro_text, llm_mode="single")
    else:
        intro_final = intro_text or ""
        outro_final = outro_text or ""

    if ai_polish and (main_body or "").strip() and not skip_model_polish_main:
        _lm = "dual" if tts_mode == "dual" else "single"
        main_body = polish_for_reading(main_body, llm_mode=_lm)
    if tts_mode == "dual" and (main_body or "").strip():
        main_body = normalize_dialogue_speaker_lines(main_body)
        if ai_polish and pre_polish_dual_body:
            n_pre = len(parse_tts_dialogue_lines(pre_polish_dual_body))
            n_post = len(parse_tts_dialogue_lines(main_body))
            if n_pre >= 2 and n_post <= 1:
                main_body = pre_polish_dual_body
                polished = False

    if tts_mode == "dual":
        if not voice_id_1 or not voice_id_2:
            raise RuntimeError("双人模式需提供 voice_id_1 与 voice_id_2")
    elif not voice_id:
        raise RuntimeError("未提供音色 voice_id")

    from pydub import AudioSegment  # type: ignore

    audio_parts: list[Any] = []
    part_titles: list[str] = []
    last_trace: str | None = None
    last_upstream: int | None = None
    retries_total = 0
    attempt_errors: list[dict[str, Any]] = []
    single_sentence_chunk_count: int | None = None
    dialogue_segments_original: int | None = None
    dialogue_segments_merged: int | None = None
    tts_estimated_wait_sec: int | None = None
    auto_degraded = False
    auto_degrade_reason = ""

    def _tts_synth_chunk_return(
        content: str, vid: str, chapter_title: str
    ) -> tuple[Any, str, str | None, int | None, int, list[dict[str, Any]]]:
        if not content.strip():
            raise ValueError("empty_chunk")
        text_in = _tts_segment_text_cleanup(content.strip())
        if not text_in.strip():
            raise ValueError("empty_after_cleanup")
        tts = synthesize_tts(text_in, voice_id=vid, api_key=api_key)
        hx = str(tts.get("audio_hex") or "")
        seg = _hex_to_segment(hx)
        if seg is None:
            raise RuntimeError("音频解码失败")
        ttl = (chapter_title or "段落").strip()[:200] or "段落"
        tr_raw = str(tts.get("trace_id") or "").strip()
        tr: str | None = tr_raw if tr_raw else None
        up = tts.get("upstream_status_code")
        up_i = int(up) if up is not None else None
        rtry = int(tts.get("retries") or 0)
        aerr = list(tts.get("attempt_errors") or []) if tts.get("attempt_errors") else []
        return seg, ttl, tr, up_i, rtry, aerr

    def synth_one(content: str, vid: str, chapter_title: str) -> None:
        nonlocal last_trace, last_upstream, retries_total
        try:
            seg, ttl, tr, up_i, rtry, aerr = _tts_synth_chunk_return(content, vid, chapter_title)
        except ValueError:
            return
        audio_parts.append(seg)
        part_titles.append(ttl)
        if tr:
            last_trace = tr
        if up_i is not None:
            last_upstream = up_i
        retries_total += rtry
        if aerr:
            attempt_errors.extend(aerr)

    effective_tts_mode = tts_mode
    effective_voice_id_single = voice_id
    if tts_mode == "single":
        intro_voice = intro_voice_override or voice_id
        outro_voice = outro_voice_override or voice_id
    else:
        intro_voice = intro_voice_override or voice_id_1
        outro_voice = outro_voice_override or voice_id_1

    seg_intro_bgm1 = _optional_bgm_segment(payload, "intro_bgm1")
    if seg_intro_bgm1 is not None:
        audio_parts.append(seg_intro_bgm1)
        part_titles.append("片头垫乐")

    if intro_final:
        synth_one(intro_final, intro_voice, "开场")

    seg_intro_bgm2 = _optional_bgm_segment(payload, "intro_bgm2")
    if seg_intro_bgm2 is not None:
        audio_parts.append(seg_intro_bgm2)
        part_titles.append("过场垫乐")

    if tts_mode == "single":
        body = (main_body or "").strip() if main_body else ""
        if not body.strip() and not intro_final and not outro_final:
            raise RuntimeError("正文为空")
        if body.strip():
            if tts_sentence_chunks:
                chunks = split_text_into_tts_sentence_chunks(
                    body, max_chunk_chars=tts_max_chunk_chars
                )
                chunk_jobs: list[tuple[int, str, str, str]] = []
                chunk_idx = 0
                for ch in chunks:
                    c = ch.strip()
                    if c:
                        chunk_idx += 1
                        chunk_jobs.append((chunk_idx, c, voice_id, f"段落 {chunk_idx}"))
                single_sentence_chunk_count = len(chunk_jobs)
                max_workers = max(1, min(8, int(os.getenv("TTS_SYNTH_MAX_WORKERS", "2") or "2")))
                if len(chunk_jobs) > 1 and max_workers > 1:

                    def _single_parallel(job: tuple[int, str, str, str]) -> tuple[int, Any, str, str | None, int | None, int, list]:
                        sort_i, c, vid, title = job
                        seg, ttl, tr, up_i, rtry, aerr = _tts_synth_chunk_return(c, vid, title)
                        return sort_i, seg, ttl, tr, up_i, rtry, aerr

                    with ThreadPoolExecutor(max_workers=max_workers) as ex:
                        futures = [ex.submit(_single_parallel, j) for j in chunk_jobs]
                        for fu in futures:
                            _si, seg, ttl, tr, up_i, rtry, aerr = fu.result()
                            audio_parts.append(seg)
                            part_titles.append(ttl)
                            if tr:
                                last_trace = tr
                            if up_i is not None:
                                last_upstream = up_i
                            retries_total += rtry
                            if aerr:
                                attempt_errors.extend(aerr)
                    if progress_hook and single_sentence_chunk_count:
                        progress_hook(94, f"分段合成完成（{single_sentence_chunk_count} 段）")
                else:
                    for sort_i, c, vid, title in chunk_jobs:
                        synth_one(c, vid, title)
            else:
                synth_one(body, voice_id, "正文")
    else:
        lines = parse_tts_dialogue_lines(main_body)
        dialogue_segments_original = len(lines)
        try:
            from app.fyv_shared.config import TTS_RATE_LIMIT_CONFIG

            rpm_limit = int(TTS_RATE_LIMIT_CONFIG.get("rpm_limit", 20))
        except Exception:
            rpm_limit = 20
        merge_short_chars = max(8, min(120, int(payload.get("dual_merge_short_chars") or 18)))
        merge_target_chars = max(40, min(480, int(payload.get("dual_merge_target_chars") or 120)))
        merge_max_chars = max(80, min(720, int(payload.get("dual_merge_max_chars") or 260)))
        merged_lines = _merge_dual_dialogue_segments(
            lines,
            min_short_chars=merge_short_chars,
            target_chars=merge_target_chars,
            max_chars=merge_max_chars,
        )
        dialogue_segments_merged = len(merged_lines)
        tts_estimated_wait_sec = _estimate_throttle_wait_seconds(dialogue_segments_merged, rpm_limit)

        # AI 润色后对白轮次往往变多，易触发下文「快速单人」合并；但正文仍是标准 Speaker 行，
        # 降级会把全文交给 S1 单音色，与双人预期不符，故润色开启时不做自动降级。
        allow_auto_degrade = bool(payload.get("auto_degrade_tts", True)) and not ai_polish
        soft_limit = max(6, int(payload.get("dual_tts_soft_segment_limit") or max(rpm_limit + 4, 14)))
        if allow_auto_degrade and dialogue_segments_merged > soft_limit:
            wait_before = _estimate_throttle_wait_seconds(dialogue_segments_original, rpm_limit)
            wait_after_merge = _estimate_throttle_wait_seconds(dialogue_segments_merged, rpm_limit)
            should_degrade = wait_after_merge >= 60 or wait_before - wait_after_merge >= 60
            if should_degrade:
                effective_tts_mode = "single"
                effective_voice_id_single = voice_id_1
                main_body = "\n".join([c for _, c in merged_lines]).strip()
                auto_degraded = True
                auto_degrade_reason = (
                    f"dual_segments={dialogue_segments_merged}, rpm_limit={rpm_limit}, "
                    f"estimated_wait_sec={wait_after_merge}"
                )
                if progress_hook:
                    progress_hook(66, "双人分段较多，已自动切换快速合成模式")
        if effective_tts_mode == "dual":
            lines = merged_lines
        if effective_tts_mode == "dual":
            if not lines:
                if not intro_final and not outro_final:
                    raise RuntimeError("正文为空")
            n_lines = len(lines)
            dual_jobs: list[tuple[int, str, str, str]] = []
            for idx, (sp, chunk) in enumerate(lines):
                c = (chunk or "").strip() if chunk and chunk.strip() else chunk
                vid = voice_id_1 if sp == "1" else voice_id_2
                stub = (c or "").replace("\n", " ").strip()
                if len(stub) > 42:
                    stub = stub[:42] + "…"
                label = f"说话人{sp}"
                if stub:
                    label = f"{label} · {stub}"
                dual_jobs.append((idx, c, vid, label))
            max_workers_dual = max(1, min(8, int(os.getenv("TTS_SYNTH_MAX_WORKERS", "2") or "2")))
            if len(dual_jobs) > 1 and max_workers_dual > 1:

                def _dual_parallel(
                    item: tuple[int, str, str, str],
                ) -> tuple[int, Any, str, str | None, int | None, int, list]:
                    _idx, c2, vid2, label2 = item
                    seg, ttl, tr, up_i, rtry, aerr = _tts_synth_chunk_return(c2, vid2, label2)
                    return _idx, seg, ttl, tr, up_i, rtry, aerr

                with ThreadPoolExecutor(max_workers=max_workers_dual) as ex:
                    futures = [ex.submit(_dual_parallel, j) for j in dual_jobs]
                    for fu in futures:
                        _idx, seg, ttl, tr, up_i, rtry, aerr = fu.result()
                        audio_parts.append(seg)
                        part_titles.append(ttl)
                        if tr:
                            last_trace = tr
                        if up_i is not None:
                            last_upstream = up_i
                        retries_total += rtry
                        if aerr:
                            attempt_errors.extend(aerr)
                if progress_hook and n_lines:
                    progress_hook(94, f"双人对话合成 {n_lines}/{n_lines}")
            else:
                for idx, (sp, chunk) in enumerate(lines):
                    if progress_hook and n_lines:
                        pct = 62 + int(28 * (idx + 1) / max(n_lines, 1))
                        progress_hook(min(pct, 94), f"双人对话合成 {idx + 1}/{n_lines}")
                    c = (chunk or "").strip() if chunk and chunk.strip() else chunk
                    vid = voice_id_1 if sp == "1" else voice_id_2
                    stub = (c or "").replace("\n", " ").strip()
                    if len(stub) > 42:
                        stub = stub[:42] + "…"
                    label = f"说话人{sp}"
                    if stub:
                        label = f"{label} · {stub}"
                    synth_one(c, vid, label)
        else:
            body = (main_body or "").strip() if main_body else ""
            if body.strip():
                synth_one(body, effective_voice_id_single, "正文")

    if outro_final:
        synth_one(outro_final, outro_voice, "结尾")

    seg_outro_bgm3 = _optional_bgm_segment(payload, "outro_bgm3")
    if seg_outro_bgm3 is not None:
        audio_parts.append(seg_outro_bgm3)
        part_titles.append("片尾垫乐")

    if not audio_parts:
        raise RuntimeError("没有可合成的音频内容")

    combined = AudioSegment.empty()
    for p in audio_parts:
        combined += p

    out_hex = _segment_to_hex(combined)

    audio_chapters: list[dict[str, Any]] = []
    cursor_ms = 0
    for seg, ttl in zip(audio_parts, part_titles):
        try:
            seg_len = int(len(seg))
        except Exception:
            seg_len = 0
        if seg_len <= 0:
            continue
        audio_chapters.append({"title": ttl, "start_ms": cursor_ms, "end_ms": cursor_ms + seg_len})
        cursor_ms += seg_len

    cover_image: str | None = None
    cover_error: str | None = None
    if bool(payload.get("generate_cover", True)):
        chunks: list[str] = []
        if intro_final:
            chunks.append(intro_final[:400])
        body_txt = (main_body or "").strip() if main_body else ""
        if body_txt.strip():
            chunks.append(body_txt[:1000])
        if outro_final:
            chunks.append(outro_final[:400])
        summary = "\n".join(chunks).strip() or "语音朗读内容"
        cover_image, cover_error = generate_cover_image(summary[:1200], api_key)

    out: dict[str, Any] = {
        "audio_hex": out_hex,
        "trace_id": last_trace,
        "upstream_status_code": last_upstream,
        "retries": retries_total,
        "nonfatal_errors": attempt_errors,
        "polished": polished,
        "tts_mode": effective_tts_mode,
        "tts_mode_requested": tts_mode,
        "cover_image": cover_image,
    }
    if dialogue_segments_original is not None:
        out["dialogue_segments_original"] = dialogue_segments_original
    if dialogue_segments_merged is not None:
        out["dialogue_segments_merged"] = dialogue_segments_merged
    if tts_estimated_wait_sec is not None:
        out["tts_estimated_wait_sec"] = tts_estimated_wait_sec
    if auto_degraded:
        out["auto_degraded"] = True
        out["auto_degrade_reason"] = auto_degrade_reason
    if single_sentence_chunk_count is not None:
        out["tts_sentence_chunk_count"] = single_sentence_chunk_count
    if cover_error:
        out["cover_error"] = cover_error
    # 供任务结果 / 对象存储：与合成用书稿一致（含 AI 润色与双人降级后的 main_body）
    out["tts_main_body"] = (main_body or "").strip()
    out["tts_intro_text"] = intro_final
    out["tts_outro_text"] = outro_final
    if audio_chapters:
        out["audio_chapters"] = audio_chapters
    return out

import json
import math
import re


def tail_dialogue_for_continuation(produced: str, max_chars: int = 3600) -> str:
    p = (produced or "").rstrip()
    if not p:
        return ""
    if len(p) <= max_chars:
        return p
    chunk = p[-max_chars:]
    first_nl = chunk.find("\n")
    if first_nl != -1:
        chunk = chunk[first_nl + 1:]
    return chunk.strip()


def build_structured_memory(produced: str, max_lines: int = 20) -> str:
    text = (produced or "").strip()
    if not text:
        return ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    tail_lines = lines[-max_lines:]
    if not tail_lines:
        return ""
    token_hits = re.findall(r"[\u4e00-\u9fff]{2,}|[A-Za-z0-9_]{3,}", "\n".join(tail_lines))
    freq = {}
    for t in token_hits:
        k = t.lower()
        if len(k) < 2:
            continue
        freq[k] = freq.get(k, 0) + 1
    top_terms = sorted(freq.items(), key=lambda x: x[1], reverse=True)[:8]
    key_terms = [k for k, _ in top_terms]
    last_speaker = "Speaker1"
    for ln in reversed(tail_lines):
        if ln.startswith("Speaker2:"):
            last_speaker = "Speaker2"
            break
        if ln.startswith("Speaker1:"):
            last_speaker = "Speaker1"
            break
    open_q = []
    for ln in tail_lines[-8:]:
        body = ln.split(":", 1)[-1].strip() if ":" in ln else ln
        if "?" in body or "？" in body:
            open_q.append(body[:80])
    open_q = open_q[-3:]
    normalized_tail = [re.sub(r"\s+", "", ln.split(":", 1)[-1]) for ln in tail_lines if ":" in ln]
    seen = set()
    repeats = []
    for s in normalized_tail:
        if s in seen and s:
            repeats.append(s[:40])
        seen.add(s)
    repeats = repeats[-5:]
    resolved_points = []
    for ln in tail_lines[-10:]:
        body = ln.split(":", 1)[-1].strip() if ":" in ln else ln
        if body and ("?" not in body and "？" not in body):
            resolved_points.append(body[:70])
    resolved_points = resolved_points[-4:]
    fact_anchors = []
    for ln in tail_lines[-12:]:
        body = ln.split(":", 1)[-1].strip() if ":" in ln else ln
        if re.search(r"\d|%|AI|模型|成本|效率|时长|预算|案例", body, re.I):
            fact_anchors.append(body[:90])
    fact_anchors = fact_anchors[-5:]
    term_dict = [{"term": t, "note": "后续保持同一叫法"} for t in key_terms[:6]]
    exclaim = sum(1 for ln in tail_lines if ("!" in ln or "！" in ln))
    qcount = sum(1 for ln in tail_lines if ("?" in ln or "？" in ln))
    pacing = "偏热" if exclaim >= 3 else ("偏探问" if qcount >= 3 else "平稳")
    memory = {
        "last_speaker": last_speaker,
        "recent_key_terms": key_terms,
        "term_dictionary": term_dict,
        "fact_anchors": fact_anchors,
        "resolved_points": resolved_points,
        "open_questions": open_q,
        "forbidden_repeats": repeats,
        "tone_hint": "保持与上一段一致的口语化与信息密度",
        "pacing_hint": pacing,
        "next_speaker_hint": "优先让与 last_speaker 相反的角色先开口，避免单人长连发",
    }
    return json.dumps(memory, ensure_ascii=False)


def build_global_constitution(script_language, script_style, program_name, speaker1_persona, speaker2_persona):
    return (
        f"语言={script_language}；风格={script_style}；节目名={program_name}。\n"
        f"Speaker1人设={speaker1_persona}；Speaker2人设={speaker2_persona}。\n"
        "全局硬规则：每行必须以 Speaker1: 或 Speaker2: 开头，一行一句；"
        "禁止动作/场景括号描述；术语叫法前后一致；避免重复同一观点。"
    )


# 与 post_edit_script_for_coherence 中段间「重复开场」检测保持一致
SEGMENT_RESTART_BODY_RE = re.compile(
    r"(大家好|欢迎收听|今天我们来聊|这一期我们来聊|欢迎收听本期|本期节目|我是主持人)"
)


def segment_head_suggests_restart(head_dialogue: str) -> bool:
    """新段开头若干行是否像又一次节目开场（适合触发 API 衔接优化）。"""
    lines = [ln.strip() for ln in (head_dialogue or "").splitlines() if ln.strip()][:6]
    for ln in lines:
        if ln.startswith("Speaker1:") or ln.startswith("Speaker2:"):
            body = ln.split(":", 1)[-1].strip()
        else:
            body = ln
        if SEGMENT_RESTART_BODY_RE.search(body):
            return True
    return False


def extract_tail_hook_phrases(tail_text: str, max_phrases: int = 2) -> str:
    """
    从衔接用尾部文本中取 1～2 个简短锚点（用于桥接句语义对齐），失败则返回空串。
    """
    lines = [ln.strip() for ln in (tail_text or "").splitlines() if ln.strip()]
    if not lines:
        return ""
    last = lines[-1]
    body = last.split(":", 1)[-1].strip() if ":" in last else last
    if len(body) < 4:
        return ""
    # 优先取 4～8 字的中文片段作「钩子」
    chunks = re.findall(r"[\u4e00-\u9fff]{4,12}", body)
    if chunks:
        pick = chunks[-1][:8]
        return pick
    words = re.findall(r"[\u4e00-\u9fff]{2,4}", body)
    if not words:
        return ""
    return "、".join(words[-max_phrases:])[:24]


def post_edit_script_for_coherence(text: str) -> str:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    out = []
    last_body = ""
    last_speaker = "Speaker2"
    for ln in lines:
        if ln.startswith("Speaker1:") or ln.startswith("Speaker2:"):
            speaker, body = ln.split(":", 1)
            body = body.strip()
        else:
            body = ln.strip()
            speaker = "Speaker1" if last_speaker == "Speaker2" else "Speaker2"
        if not body:
            continue
        if re.sub(r"\s+", "", body) == re.sub(r"\s+", "", last_body):
            continue
        # 仅允许开头出现一次“节目开场句”，减少分段重启感
        if len(out) > 4 and SEGMENT_RESTART_BODY_RE.search(body):
            continue
        out.append(f"{speaker}: {body}")
        last_body = body
        last_speaker = speaker
    return "\n".join(out)


def parse_outline_segments(outline_text: str, total_target: int, max_single: int):
    raw = (outline_text or "").strip()
    payload = None
    if raw:
        try:
            payload = json.loads(raw)
        except Exception:
            m = re.search(r"\{[\s\S]*\}", raw)
            if m:
                try:
                    payload = json.loads(m.group(0))
                except Exception:
                    payload = None
    segments = []
    if isinstance(payload, dict) and isinstance(payload.get("segments"), list):
        for i, seg in enumerate(payload.get("segments"), start=1):
            if not isinstance(seg, dict):
                continue
            title = str(seg.get("title", f"第{i}段")).strip() or f"第{i}段"
            try:
                tc = int(seg.get("target_chars", max_single))
            except Exception:
                tc = max_single
            tc = max(600, min(tc, max_single))
            must_include = seg.get("must_include")
            if not isinstance(must_include, list):
                must_include = []
            must_include = [str(x).strip() for x in must_include if str(x).strip()][:5]
            transition_hint = str(seg.get("transition_hint", "")).strip()
            segments.append({"id": i, "title": title, "target_chars": tc, "must_include": must_include, "transition_hint": transition_hint})
    if not segments:
        n = max(2, int(math.ceil(total_target / max_single)))
        for i in range(1, n + 1):
            segments.append({"id": i, "title": f"第{i}段", "target_chars": max(600, min(max_single, int(math.ceil(total_target / n)))), "must_include": [], "transition_hint": ""})
    return segments


def strip_premature_closing(text: str, keep_tail_lines: int = 14) -> str:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if not lines:
        return ""
    tail_start = max(0, len(lines) - keep_tail_lines)
    closing_re = re.compile(r"(感谢收听|下期再见|我们下次再聊|先聊到这里|今天就到这里|再见|拜拜)")
    out = []
    for i, ln in enumerate(lines):
        if i < tail_start and closing_re.search(ln):
            continue
        out.append(ln)
    return "\n".join(out)

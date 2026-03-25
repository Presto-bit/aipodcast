"""
轻量 RAG 工具（无额外依赖）
用于长参考资料的本地分块与关键词检索。
"""

import re
from typing import List, Dict, Tuple


def split_text_into_chunks(text: str, chunk_size: int = 1800, overlap: int = 220) -> List[str]:
    src = (text or "").strip()
    if not src:
        return []
    if len(src) <= chunk_size:
        return [src]

    chunks: List[str] = []
    i = 0
    n = len(src)
    while i < n:
        end = min(n, i + chunk_size)
        piece = src[i:end]
        # 优先按段落/句号边界收口，减少半句切分
        if end < n:
            last_break = max(piece.rfind("\n"), piece.rfind("。"), piece.rfind("！"), piece.rfind("？"))
            if last_break >= int(len(piece) * 0.55):
                piece = piece[: last_break + 1]
                end = i + len(piece)
        piece = piece.strip()
        if piece:
            chunks.append(piece)
        if end >= n:
            break
        i = max(i + 1, end - overlap)
    return chunks


def _tokenize(text: str) -> List[str]:
    raw = re.findall(r"[\u4e00-\u9fff]{2,}|[A-Za-z0-9_]+", (text or "").lower())
    # 去除极短 token 噪声
    return [t for t in raw if len(t) >= 2]


def _score_chunk(query_tokens: set, chunk: str) -> float:
    if not query_tokens:
        return 0.0
    c_tokens = _tokenize(chunk)
    if not c_tokens:
        return 0.0
    c_set = set(c_tokens)
    overlap = len(query_tokens & c_set)
    if overlap == 0:
        return 0.0
    coverage = overlap / max(1, len(query_tokens))
    density = overlap / max(1, len(c_set))
    # 兼顾命中广度和密度
    return coverage * 0.7 + density * 0.3


def retrieve_top_chunks(source_text: str, query_text: str, top_k: int = 12) -> Tuple[List[Dict], int]:
    chunks = split_text_into_chunks(source_text)
    q_tokens = set(_tokenize(query_text))
    scored = []
    for idx, ch in enumerate(chunks):
        s = _score_chunk(q_tokens, ch)
        scored.append((s, idx, ch))
    scored.sort(key=lambda x: x[0], reverse=True)

    # 若 query 命中太弱，回退到前 N 块，避免空检索
    top = [x for x in scored if x[0] > 0][:top_k]
    if not top:
        top = scored[: max(1, min(top_k, len(scored)))]

    # 按原文顺序拼回，提升可读连贯性
    top_sorted = sorted(top, key=lambda x: x[1])
    result = [{"chunk_index": idx + 1, "score": s, "content": ch} for s, idx, ch in top_sorted]
    return result, len(chunks)


def build_retrieval_query(
    topic_text: str,
    script_style: str,
    script_language: str,
    program_name: str,
    speaker1_persona: str,
    speaker2_persona: str,
    script_constraints: str,
) -> str:
    parts = [
        topic_text or "",
        script_style or "",
        script_language or "",
        program_name or "",
        speaker1_persona or "",
        speaker2_persona or "",
        script_constraints or "",
    ]
    return "\n".join([p.strip() for p in parts if str(p).strip()])


def hybrid_rerank_chunks(
    vector_hits: List[Dict],
    keyword_hits: List[Dict],
    top_k: int = 12,
    vector_weight: float = 0.7,
    keyword_weight: float = 0.3,
) -> List[Dict]:
    """
    Phase-2 混合检索重排：
    - 融合向量检索 + 关键词检索分数
    - 对相邻块做轻微去冗余，提升信息多样性
    """
    merged: Dict[int, Dict] = {}

    def normalize(hits: List[Dict]) -> Dict[int, float]:
        if not hits:
            return {}
        scores = [float(h.get("score", 0.0)) for h in hits]
        mn, mx = min(scores), max(scores)
        out = {}
        for h in hits:
            idx = int(h.get("chunk_index", 0))
            s = float(h.get("score", 0.0))
            if mx > mn:
                out[idx] = (s - mn) / (mx - mn)
            else:
                out[idx] = 1.0 if s > 0 else 0.0
        return out

    vnorm = normalize(vector_hits)
    knorm = normalize(keyword_hits)

    for h in vector_hits + keyword_hits:
        idx = int(h.get("chunk_index", 0))
        if idx <= 0:
            continue
        if idx not in merged:
            merged[idx] = {
                "chunk_index": idx,
                "content": h.get("content", ""),
                "vec_score": 0.0,
                "kw_score": 0.0,
                "score": 0.0,
            }
        merged[idx]["vec_score"] = max(merged[idx]["vec_score"], vnorm.get(idx, 0.0))
        merged[idx]["kw_score"] = max(merged[idx]["kw_score"], knorm.get(idx, 0.0))

    ranked = []
    for item in merged.values():
        item["score"] = item["vec_score"] * vector_weight + item["kw_score"] * keyword_weight
        ranked.append(item)
    ranked.sort(key=lambda x: x["score"], reverse=True)

    # 轻量 MMR：避免连续相邻块全被选中
    selected: List[Dict] = []
    selected_idx = set()
    for cand in ranked:
        idx = cand["chunk_index"]
        penalty = 0.0
        for sidx in selected_idx:
            if abs(idx - sidx) <= 1:
                penalty = max(penalty, 0.12)
            elif abs(idx - sidx) <= 3:
                penalty = max(penalty, 0.06)
        final_score = cand["score"] - penalty
        if final_score <= 0 and len(selected) >= max(3, top_k // 3):
            continue
        payload = {
            "chunk_index": idx,
            "content": cand["content"],
            "score": round(final_score, 4),
            "vec_score": round(cand["vec_score"], 4),
            "kw_score": round(cand["kw_score"], 4),
        }
        selected.append(payload)
        selected_idx.add(idx)
        if len(selected) >= top_k:
            break

    # 按原文顺序输出，保证可读性
    return sorted(selected, key=lambda x: x["chunk_index"])


def _extract_key_lines(chunk: str, query_tokens: set, max_lines: int = 6) -> List[str]:
    lines = [ln.strip() for ln in re.split(r"\n+", chunk or "") if ln.strip()]
    if not lines:
        return []
    if not query_tokens:
        return lines[:max_lines]
    scored = []
    for i, ln in enumerate(lines):
        t = set(_tokenize(ln))
        hit = len(query_tokens & t)
        scored.append((hit, -i, ln))
    scored.sort(reverse=True)
    chosen = [x[2] for x in scored[:max_lines] if x[0] > 0]
    if not chosen:
        chosen = lines[:max_lines]
    return chosen


def build_full_coverage_context(
    source_text: str,
    query_text: str,
    max_total_chars: int = 16_000,
) -> Tuple[str, int]:
    """
    全量两阶段模式的阶段1：逐块提炼。
    - 对所有分块都提炼关键行，保证覆盖全部资料。
    - 返回可直接用于阶段2生成的合成上下文。
    """
    chunks = split_text_into_chunks(source_text)
    if not chunks:
        return "", 0

    q_tokens = set(_tokenize(query_text))
    parts: List[str] = []
    used = 0
    total = len(chunks)
    for idx, ch in enumerate(chunks, start=1):
        # 均匀分配预算，确保每个分块都能贡献至少 1 条关键信息（覆盖全量资料）
        remaining_chunks = max(1, total - idx + 1)
        remaining_budget = max(200, max_total_chars - used)
        per_chunk_budget = max(120, int(remaining_budget / remaining_chunks))

        # 前两块优先保留“导入背景”信息，避免一上来深聊
        if idx <= 2:
            key_lines = _extract_key_lines(ch, set(), max_lines=3)
        else:
            key_lines = _extract_key_lines(ch, q_tokens, max_lines=3)
        if not key_lines:
            continue
        compact_lines: List[str] = []
        cur = 0
        for ln in key_lines:
            t = ln.strip()
            if not t:
                continue
            # 单行也做截断，避免极长段落撑爆上下文
            if len(t) > 180:
                t = t[:180].rstrip() + "..."
            if cur + len(t) > per_chunk_budget and compact_lines:
                break
            compact_lines.append(t)
            cur += len(t)
            if cur >= per_chunk_budget:
                break

        if not compact_lines:
            compact_lines = [key_lines[0][:180].rstrip() + ("..." if len(key_lines[0]) > 180 else "")]

        if idx == 1:
            block_title = f"【阶段1提炼片段 {idx}/{total}｜背景导入】"
        elif idx == 2:
            block_title = f"【阶段1提炼片段 {idx}/{total}｜核心定义】"
        else:
            block_title = f"【阶段1提炼片段 {idx}/{total}】"
        block = block_title + "\n" + "\n".join(compact_lines)
        if used + len(block) > max_total_chars and parts:
            break
        parts.append(block)
        used += len(block)
    merged = "\n\n==========\n\n".join(parts)
    return merged, len(chunks)


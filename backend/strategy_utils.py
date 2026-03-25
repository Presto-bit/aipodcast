import hashlib
from typing import Callable, Tuple


def choose_auto_rag_top_k(total_chars: int) -> int:
    n = int(total_chars or 0)
    if n < 20_000:
        return 8
    if n < 50_000:
        return 12
    if n < 100_000:
        return 16
    return 20


def apply_long_reference_strategy(
    merged_content: str,
    user_api_key: str,
    topic_text: str,
    script_style: str,
    script_language: str,
    program_name: str,
    speaker1_persona: str,
    speaker2_persona: str,
    script_constraints: str,
    rag_store,
    minimax_client,
    split_text_into_chunks: Callable,
    build_retrieval_query: Callable,
    retrieve_top_chunks: Callable,
    hybrid_rerank_chunks: Callable,
    build_full_coverage_context: Callable,
    summarize_evidence: Callable,
    build_reasoned_context: Callable,
) -> Tuple[str, str]:
    rag_top_k = choose_auto_rag_top_k(len(merged_content))
    query = build_retrieval_query(
        topic_text,
        script_style,
        script_language,
        program_name,
        speaker1_persona,
        speaker2_persona,
        script_constraints,
    )
    try:
        doc_id = hashlib.md5(merged_content.encode("utf-8", errors="ignore")).hexdigest()
        chunks = split_text_into_chunks(merged_content)
        if chunks:
            rag_store.upsert_document(doc_id, chunks)
            vec_hits = rag_store.search(doc_id, query, top_k=rag_top_k)
            kw_hits, _ = retrieve_top_chunks(merged_content, query, top_k=rag_top_k)
            mixed_hits = hybrid_rerank_chunks(vec_hits, kw_hits, top_k=rag_top_k)
            if mixed_hits:
                evidence_for_reasoner = "\n\n".join(
                    [f"chunk#{c['chunk_index']}: {(c.get('content') or '')[:350]}" for c in mixed_hits[:16]]
                )
                reasoning_resp = minimax_client.generate_cross_doc_reasoning(
                    evidence_for_reasoner,
                    api_key=user_api_key
                )
                if reasoning_resp.get("success") and isinstance(reasoning_resp.get("reasoning"), dict):
                    reasoning = reasoning_resp.get("reasoning")
                else:
                    reasoning = summarize_evidence(mixed_hits, max_items=10)
                reasoned_context = build_reasoned_context(reasoning, mixed_hits, max_chars=12000)
                selected = []
                for c in mixed_hits:
                    selected.append(
                        f"【混合检索片段 {c['chunk_index']} | score={c['score']:.3f} | vec={c['vec_score']:.3f} | kw={c['kw_score']:.3f}】\n{c['content']}"
                    )
                return (
                    reasoned_context + "\n\n==========\n\n" + "\n\n==========\n\n".join(selected),
                    f"已启用 Phase-3 跨文档归纳：共切分 {len(chunks)} 块，融合检索 {len(mixed_hits)} 块后完成证据归纳（Top-K={rag_top_k}）。",
                )
    except Exception:
        pass

    phase1_context, chunk_count = build_full_coverage_context(merged_content, query)
    if phase1_context:
        return (
            phase1_context,
            f"已启用全量两阶段模式：阶段1提炼覆盖 {chunk_count} 个分块，阶段2基于提炼结果生成。",
        )

    top_chunks, chunk_count = retrieve_top_chunks(merged_content, query, top_k=rag_top_k)
    if not top_chunks:
        return merged_content, None
    selected = []
    for c in top_chunks:
        selected.append(f"【检索片段 {c['chunk_index']} | score={c['score']:.3f}】\n{c['content']}")
    return (
        "\n\n==========\n\n".join(selected),
        f"已启用长资料检索：共切分 {chunk_count} 块，选取 {len(top_chunks)} 块参与生成（Top-K={rag_top_k}）。",
    )

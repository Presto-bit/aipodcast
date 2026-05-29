"""usage_billing：text-embedding-v4 参考价（0.0005 元/千输入 Token）。"""

from app.usage_billing import (
    DEEPSEEK_V4_FLASH_INPUT_CACHE_HIT_CNY_PER_MTOK,
    DEEPSEEK_V4_FLASH_INPUT_CACHE_MISS_CNY_PER_MTOK,
    DEEPSEEK_V4_FLASH_OUTPUT_CNY_PER_MTOK,
    EMBEDDING_PRICING_REF_URL,
    EMBEDDING_REFERENCE_CNY_PER_KTOK,
    EMBEDDING_REFERENCE_CNY_PER_MTOK,
    EMBEDDING_REFERENCE_MODEL,
    build_usage_event_meta,
    deepseek_text_estimate_input_output_cny_per_mtok,
    estimate_embedding_cost_cny,
)


def test_deepseek_v4_flash_pricing_constants() -> None:
    assert DEEPSEEK_V4_FLASH_INPUT_CACHE_HIT_CNY_PER_MTOK == 0.02
    assert DEEPSEEK_V4_FLASH_INPUT_CACHE_MISS_CNY_PER_MTOK == 1.0
    assert DEEPSEEK_V4_FLASH_OUTPUT_CNY_PER_MTOK == 2.0
    pi, po = deepseek_text_estimate_input_output_cny_per_mtok("deepseek-v4-flash")
    assert (pi, po) == (1.0, 2.0)


def test_embedding_cost_api_backend() -> None:
    assert EMBEDDING_REFERENCE_MODEL == "text-embedding-v4"
    assert EMBEDDING_REFERENCE_CNY_PER_KTOK == 0.0005
    assert EMBEDDING_REFERENCE_CNY_PER_MTOK == 0.5
    # 1600 字 ≈ 1000 tokens → 0.0005 元
    cny = estimate_embedding_cost_cny(input_chars=1600, backend="api")
    assert cny == round((1000.0 / 1_000_000.0) * EMBEDDING_REFERENCE_CNY_PER_MTOK, 6)


def test_embedding_cost_hash_backend_zero() -> None:
    assert estimate_embedding_cost_cny(input_chars=100_000, backend="hash") == 0.0


def test_build_usage_event_meta_note_rag_index() -> None:
    job = {
        "job_type": "note_rag_index",
        "payload": {"note_id": "n1"},
        "result": {"chunks": 10, "embedding_input_chars": 8000, "embedding_backend": "api"},
    }
    meta = build_usage_event_meta(job, "succeeded")
    assert meta["embedding_cost_cny"] > 0
    assert meta["cost_total_cny"] == meta["embedding_cost_cny"]
    assert meta["embedding_model_pricing"] == EMBEDDING_REFERENCE_MODEL
    assert meta["embedding_cny_per_ktok"] == EMBEDDING_REFERENCE_CNY_PER_KTOK
    assert meta["pricing_ref_embedding"] == EMBEDDING_PRICING_REF_URL


def test_build_usage_event_meta_podcast_includes_embedding_in_total() -> None:
    job = {
        "job_type": "podcast_generate",
        "payload": {"text": "主题"},
        "result": {
            "script_text": "x" * 400,
            "embedding_input_chars": 3200,
            "embedding_backend": "api",
        },
    }
    meta = build_usage_event_meta(job, "succeeded")
    assert meta["embedding_cost_cny"] > 0
    assert meta["llm_cost_cny"] > 0
    assert meta["tts_cost_cny"] > 0
    assert meta["cost_total_cny"] >= meta["embedding_cost_cny"] + meta["llm_cost_cny"] + meta["tts_cost_cny"]

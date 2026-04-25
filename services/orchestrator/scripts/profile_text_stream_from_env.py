#!/usr/bin/env python3
"""
用环境变量（及仓库根目录 `.env.ai-native`，与编排器 `app.config` 一致）实测
`invoke_llm_chat_messages_stream_iter` 流式首包与总耗时——与知识库问答共用 TEXT_PROVIDER 路由。

不打印任何密钥；若缺少密钥会退出并提示需设置的环境变量名。

用法:
  cd services/orchestrator && PYTHONPATH=. python scripts/profile_text_stream_from_env.py
"""
from __future__ import annotations

import os
import sys
import time

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def _mask_secret(s: str) -> str:
    """不向终端泄露密钥内容，仅表示是否已配置及长度。"""
    t = (s or "").strip()
    if not t:
        return "(未设置)"
    return f"(已设置, len={len(t)})"


def _require_keys(provider: str) -> None:
    if provider == "minimax":
        if not (os.getenv("MINIMAX_API_KEY") or "").strip():
            sys.exit("缺少 MINIMAX_API_KEY，请在环境或 .env.ai-native 中配置。")
    elif provider == "deepseek":
        if not (os.getenv("DEEPSEEK_API_KEY") or "").strip():
            sys.exit("缺少 DEEPSEEK_API_KEY，请在环境或 .env.ai-native 中配置。")
    elif provider == "qwen":
        if not (os.getenv("QWEN_API_KEY") or "").strip():
            sys.exit("缺少 QWEN_API_KEY，请在环境或 .env.ai-native 中配置。")
        if not (os.getenv("QWEN_BASE_URL") or "").strip():
            sys.exit("缺少 QWEN_BASE_URL，请在环境或 .env.ai-native 中配置。")


def main() -> None:
    import app.config  # noqa: F401 — 加载 .env.ai-native（override=False）

    from app.provider_router import invoke_llm_chat_messages_stream_iter, script_provider

    prov = script_provider()
    _require_keys(prov)

    tp_raw = (os.getenv("TEXT_PROVIDER") or "").strip() or f"(未设置，默认 {prov})"
    print("--- 文本流式探针（与 notes_ask 同路由）---")
    print(f"TEXT_PROVIDER(raw)={tp_raw!r}  effective={prov!r}")
    if prov == "deepseek":
        print(f"DEEPSEEK_BASE_URL={os.getenv('DEEPSEEK_BASE_URL') or '(默认 api.deepseek.com)'}")
        print(f"DEEPSEEK_TEXT_MODEL={os.getenv('DEEPSEEK_TEXT_MODEL') or '(默认 deepseek-v4-flash)'}")
        print(f"DEEPSEEK_API_KEY={_mask_secret(os.getenv('DEEPSEEK_API_KEY') or '')}")
    elif prov == "qwen":
        print(f"QWEN_BASE_URL={os.getenv('QWEN_BASE_URL') or ''}")
        print(f"QWEN_TEXT_MODEL={os.getenv('QWEN_TEXT_MODEL') or '(默认 qwen-plus)'}")
        print(f"QWEN_API_KEY={_mask_secret(os.getenv('QWEN_API_KEY') or '')}")
    else:
        print(f"MINIMAX_API_KEY={_mask_secret(os.getenv('MINIMAX_API_KEY') or '')}")

    messages: list[dict[str, str]] = [
        {"role": "system", "content": "你是助手，回答简短。"},
        {"role": "user", "content": "请用不超过 25 个汉字回答：1+1 等于几？"},
    ]

    t0 = time.perf_counter()
    ttft_ms: float | None = None
    chunks = 0
    acc: list[str] = []
    for piece in invoke_llm_chat_messages_stream_iter(
        messages,
        temperature=0.35,
        api_key=None,
        timeout_sec=120,
    ):
        chunks += 1
        if piece:
            acc.append(piece)
            if ttft_ms is None:
                ttft_ms = (time.perf_counter() - t0) * 1000.0

    total_ms = (time.perf_counter() - t0) * 1000.0
    text = "".join(acc).strip()
    ttft_s = f"{ttft_ms:.1f}" if isinstance(ttft_ms, float) else str(ttft_ms)
    print(f"stream_chunks={chunks}  ttft_ms={ttft_s}  total_ms={total_ms:.1f}")
    print(f"reply_preview={text[:200]!r}")


if __name__ == "__main__":
    main()

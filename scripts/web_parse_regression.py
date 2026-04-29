#!/usr/bin/env python3
"""
网页解析回归脚本：
- 输入 URL 清单文件（每行一个 URL）
- 调用 ContentParser.parse_url
- 输出成功率、平均质量分、策略分布、页面类型分布、失败样本
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path
from typing import Any


def _load_urls(path: Path) -> list[str]:
    urls: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        urls.append(s)
    return urls


def _fmt_ratio(n: int, total: int) -> str:
    if total <= 0:
        return "0.0%"
    return f"{(n / total) * 100:.1f}%"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run web parsing regression metrics.")
    parser.add_argument("--urls-file", required=True, help="Path to URL list file (one URL per line).")
    parser.add_argument("--max", type=int, default=100, help="Max URLs to run.")
    parser.add_argument("--json", action="store_true", help="Print JSON output.")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    service_root = repo_root / "services" / "orchestrator"
    if str(service_root) not in sys.path:
        sys.path.insert(0, str(service_root))
    from app.fyv_shared.content_parser import content_parser  # noqa: WPS433

    url_path = Path(args.urls_file).expanduser().resolve()
    if not url_path.exists():
        raise SystemExit(f"urls file not found: {url_path}")
    urls = _load_urls(url_path)[: max(1, args.max)]
    if not urls:
        raise SystemExit("no valid urls")

    total = len(urls)
    success = 0
    quality_scores: list[float] = []
    strategy_dist: dict[str, int] = {}
    page_kind_dist: dict[str, int] = {}
    failed: list[dict[str, str]] = []

    for u in urls:
        out = content_parser.parse_url(u)
        ok = bool(out.get("success")) and bool(str(out.get("content") or "").strip())
        if ok:
            success += 1
            meta = out.get("parse_meta") if isinstance(out.get("parse_meta"), dict) else {}
            score = float(meta.get("quality_score") or 0.0)
            quality_scores.append(score)
            strategy = str(meta.get("strategy") or "unknown")
            page_kind = str(meta.get("page_kind") or "unknown")
            strategy_dist[strategy] = strategy_dist.get(strategy, 0) + 1
            page_kind_dist[page_kind] = page_kind_dist.get(page_kind, 0) + 1
        else:
            failed.append(
                {
                    "url": u,
                    "error": str(out.get("error") or "unknown")[:240],
                    "error_code": str(out.get("error_code") or ""),
                }
            )

    result: dict[str, Any] = {
        "total": total,
        "success": success,
        "success_rate": round(success / total, 4),
        "avg_quality_score": round(statistics.mean(quality_scores), 4) if quality_scores else 0.0,
        "strategy_distribution": strategy_dist,
        "page_kind_distribution": page_kind_dist,
        "failed_samples": failed[:20],
    }

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"总数: {total}")
        print(f"成功: {success} ({_fmt_ratio(success, total)})")
        print(f"平均质量分: {result['avg_quality_score']}")
        print("策略分布:")
        for k, v in sorted(strategy_dist.items(), key=lambda x: x[1], reverse=True):
            print(f"  - {k}: {v}")
        print("页面类型分布:")
        for k, v in sorted(page_kind_dist.items(), key=lambda x: x[1], reverse=True):
            print(f"  - {k}: {v}")
        if failed:
            print("失败样本（前 20）:")
            for row in failed[:20]:
                print(f"  - [{row['error_code']}] {row['url']} :: {row['error']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

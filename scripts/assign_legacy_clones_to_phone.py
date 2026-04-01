#!/usr/bin/env python3
"""
将 legacy_backend/data/saved_voices.json 中的克隆音色写入 PostgreSQL，
并（若有 sourceSpeaker）同步 minimax_aipodcast_speaker_cloned_voice_ids。

典型用法：把「一一」「ZH」两条克隆归属到指定手机号（默认 18101383358）。

依赖：仓库根目录已配置 .env.ai-native / 编排器同源的 DB 连接（见 services/orchestrator/app/config）。

  python3 scripts/assign_legacy_clones_to_phone.py
  python3 scripts/assign_legacy_clones_to_phone.py --phone 18101383358
  python3 scripts/assign_legacy_clones_to_phone.py --json path/to/saved_voices.json --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ORCH = os.path.join(ROOT, "services", "orchestrator")
if _ORCH not in sys.path:
    sys.path.insert(0, _ORCH)

from app.models import merge_user_preferences_for_phone, replace_saved_voices_for_user  # noqa: E402
from app.fyv_shared.config import VOICE_STORE_FILE  # noqa: E402


def _legacy_row_to_voice(row: dict[str, Any]) -> dict[str, Any]:
    vid = str(row.get("voiceId") or "").strip()
    name = str(row.get("displayName") or vid).strip() or vid
    out: dict[str, Any] = {"voiceId": vid, "displayName": name}
    for k in ("createdAt", "lastUsedAt"):
        if row.get(k) is not None:
            out[k] = row[k]
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="legacy saved_voices.json -> PG 指定手机号")
    ap.add_argument("--phone", default="18101383358", help="目标用户手机号")
    ap.add_argument(
        "--json",
        default=VOICE_STORE_FILE,
        help="legacy 收藏 JSON 路径（数组）",
    )
    ap.add_argument("--dry-run", action="store_true", help="只打印，不写库")
    args = ap.parse_args()

    phone = str(args.phone or "").strip()
    if not phone:
        print("缺少手机号", file=sys.stderr)
        return 2

    path = str(args.json or "").strip()
    if not os.path.isfile(path):
        print(f"未找到 {path}", file=sys.stderr)
        return 1

    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except json.JSONDecodeError as exc:
        print(f"JSON 无效: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"无法读取 {path}: {exc}", file=sys.stderr)
        return 1
    if not isinstance(raw, list):
        print("JSON 须为数组", file=sys.stderr)
        return 1

    rows_in: list[dict[str, Any]] = [x for x in raw if isinstance(x, dict)]
    voices: list[dict[str, Any]] = []
    speaker1_id: str | None = None
    speaker2_id: str | None = None

    # 先按「一一」→ speaker1、「ZH」→ speaker2 名称约定（与 sourceSpeaker 一致时写入偏好）
    for row in rows_in:
        vid = str(row.get("voiceId") or "").strip()
        if not vid:
            continue
        label = str(row.get("displayName") or "").strip()
        v = _legacy_row_to_voice(row)
        voices.append(v)
        src_sp = str(row.get("sourceSpeaker") or "").strip().lower()
        if src_sp == "speaker1" or label == "一一":
            speaker1_id = vid
        if src_sp == "speaker2" or label.upper() == "ZH":
            speaker2_id = vid

    if not voices:
        print("没有可写入的音色行", file=sys.stderr)
        return 1

    print(f"目标手机号: {phone}")
    print(f"将写入 {len(voices)} 条收藏音色: {[v.get('displayName') for v in voices]}")
    print(f"偏好 Speaker 克隆: speaker1={speaker1_id!r}, speaker2={speaker2_id!r}")

    if args.dry_run:
        print("[dry-run] 跳过写库")
        return 0

    ok, err, n = replace_saved_voices_for_user(phone, voices)
    if not ok:
        print(f"写入 user_saved_voices 失败: {err}", file=sys.stderr)
        return 1
    print(f"已写入 user_saved_voices，共 {n} 条")

    pref_patch: dict[str, Any] = {}
    if speaker1_id or speaker2_id:
        pref_patch["minimax_aipodcast_speaker_cloned_voice_ids"] = {
            "speaker1": speaker1_id,
            "speaker2": speaker2_id,
        }
    if pref_patch:
        ok2, err2 = merge_user_preferences_for_phone(phone, pref_patch)
        if not ok2:
            print(f"写入 user_preferences 失败: {err2}", file=sys.stderr)
            return 1
        print("已更新 minimax_aipodcast_speaker_cloned_voice_ids（云端偏好）")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

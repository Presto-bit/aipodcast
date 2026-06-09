"""Manuscript patch：scope 推断、diff keys、pendingPatch 载荷。"""
from __future__ import annotations

import re
from typing import Any


def infer_patch_scope(message: str) -> set[str]:
    q = str(message or "").strip()
    scopes: set[str] = set()
    if re.search(r"只改标题|改标题|标题改|别动正文|仅改标题", q):
        scopes.add("title")
    if re.search(r"只改正文|改正文|别动标题|第二段|段落", q):
        scopes.add("body")
    if re.search(r"话题|hashtag|标签", q) and re.search(r"改|换|优化", q):
        scopes.add("hashtags")
    if re.search(r"封面", q) and re.search(r"改|换", q):
        scopes.add("coverBrief")
    return scopes


def _block_sig(block: dict[str, Any]) -> str:
    kind = str(block.get("kind") or "").strip()
    if kind == "hashtags":
        tags = block.get("tags")
        if isinstance(tags, list):
            return "|".join(str(t) for t in tags)
        return ""
    return str(block.get("text") or "").strip()


def _key_for_block(block: dict[str, Any], title_index: int) -> str:
    kind = str(block.get("kind") or "").strip()
    if kind == "title":
        return f"title:{title_index}"
    if kind == "body":
        return "body:p:0"
    return kind


def diff_changed_keys(
    base_blocks: list[dict[str, Any]],
    proposed_blocks: list[dict[str, Any]],
) -> list[str]:
    def index_map(blocks: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        title_n = 0
        out: dict[str, dict[str, Any]] = {}
        for b in blocks:
            if not isinstance(b, dict):
                continue
            idx = title_n if str(b.get("kind")) == "title" else 0
            if str(b.get("kind")) == "title":
                key = _key_for_block(b, title_n)
                title_n += 1
            else:
                key = _key_for_block(b, 0)
            out[key] = b
        return out

    base_map = index_map(base_blocks)
    prop_map = index_map(proposed_blocks)
    keys = set(base_map) | set(prop_map)
    changed: list[str] = []
    for key in sorted(keys):
        a = base_map.get(key)
        b = prop_map.get(key)
        if not a or not b or _block_sig(a) != _block_sig(b):
            changed.append(key)
    return changed


def mask_proposed_to_scope(
    base_blocks: list[dict[str, Any]],
    proposed_blocks: list[dict[str, Any]],
    scopes: set[str],
) -> list[dict[str, Any]]:
    if not base_blocks or not scopes:
        return proposed_blocks
    title_n = 0
    prop_map: dict[str, dict[str, Any]] = {}
    for b in proposed_blocks:
        if not isinstance(b, dict):
            continue
        kind = str(b.get("kind") or "")
        if kind == "title":
            prop_map[_key_for_block(b, title_n)] = b
            title_n += 1
        else:
            prop_map[_key_for_block(b, 0)] = b

    title_n = 0
    merged: list[dict[str, Any]] = []
    for b in base_blocks:
        if not isinstance(b, dict):
            continue
        kind = str(b.get("kind") or "")
        allowed = kind in scopes or (kind == "title" and "title" in scopes)
        if kind == "title":
            key = _key_for_block(b, title_n)
            title_n += 1
        else:
            key = _key_for_block(b, 0)
        if allowed and key in prop_map:
            merged.append(prop_map[key])
        else:
            merged.append(b)
    return merged


def build_pending_patch_payload(
    *,
    from_version_id: str,
    from_blocks: list[dict[str, Any]],
    proposed_blocks: list[dict[str, Any]],
    message: str,
    reason: str,
    source_run_id: str,
    quality_note: str = "",
) -> dict[str, Any]:
    scopes = infer_patch_scope(message)
    if scopes and from_blocks:
        proposed_blocks = mask_proposed_to_scope(from_blocks, proposed_blocks, scopes)
    changed = diff_changed_keys(from_blocks, proposed_blocks)
    summary = "首稿" if not from_blocks else "改版提议"
    if scopes == {"title"}:
        summary = "改标题"
    elif "body" in scopes:
        summary = "改正文"
    return {
        "fromVersionId": from_version_id or "",
        "proposedBlocks": proposed_blocks,
        "changedKeys": changed,
        "selections": changed,
        "summary": summary,
        "reason": reason[:480] if reason else "",
        "qualityNote": quality_note[:240] if quality_note else "",
        "sourceRunId": source_run_id,
    }

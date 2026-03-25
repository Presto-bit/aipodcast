"""
跨文档证据归纳器（Phase-3）
输入多片段，输出 facts/conflicts/consensus/open_questions。
"""

import re
from typing import Dict, List


def _sentences(text: str) -> List[str]:
    src = (text or "").strip()
    if not src:
        return []
    parts = re.split(r"[。！？!?]\s*|\n+", src)
    return [p.strip() for p in parts if p and p.strip()]


def _normalize_key(s: str) -> str:
    s = re.sub(r"\s+", "", s.lower())
    s = re.sub(r"[^\u4e00-\u9fffa-z0-9]", "", s)
    return s


def summarize_evidence(chunks: List[Dict], max_items: int = 12) -> Dict:
    """
    基于检索片段构建轻量跨文档归纳。
    """
    claims_map = {}
    source_claims: Dict[int, List[str]] = {}

    for item in chunks or []:
        idx = int(item.get("chunk_index", 0))
        content = item.get("content", "")
        sents = _sentences(content)[:8]
        source_claims[idx] = sents
        for s in sents:
            k = _normalize_key(s[:90])
            if not k:
                continue
            slot = claims_map.setdefault(k, {"claim": s[:120], "sources": []})
            if idx not in slot["sources"]:
                slot["sources"].append(idx)

    claims = list(claims_map.values())
    claims.sort(key=lambda x: len(x["sources"]), reverse=True)

    facts = []
    singles = []
    for c in claims:
        payload = {
            "claim": c["claim"],
            "sources": [f"chunk#{i}" for i in c["sources"][:3]],
        }
        if len(c["sources"]) >= 2:
            facts.append(payload)
        else:
            singles.append(payload)

    conflicts = []
    for a in singles[: max_items]:
        for b in singles[: max_items]:
            if a is b:
                continue
            ta = a["claim"]
            tb = b["claim"]
            # 轻量冲突启发式：同主题词出现但极性词相反
            if any(k in ta for k in ["提高", "增加", "更高"]) and any(k in tb for k in ["降低", "减少", "更低"]):
                conflicts.append({"topic": "效果方向", "a": ta, "b": tb})
                if len(conflicts) >= 4:
                    break
        if len(conflicts) >= 4:
            break

    consensus = [f["claim"] for f in facts[: max_items]]
    open_questions = [s["claim"] for s in singles[: max_items] if s["claim"] not in consensus][:6]

    return {
        "facts": facts[:max_items],
        "conflicts": conflicts[:4],
        "consensus": consensus[:max_items],
        "open_questions": open_questions,
    }


def build_reasoned_context(reasoning: Dict, chunks: List[Dict], max_chars: int = 12000) -> str:
    lines = []
    lines.append("【跨文档证据归纳】")
    lines.append("共识结论：")
    for x in reasoning.get("consensus", [])[:10]:
        lines.append(f"- {x}")
    if reasoning.get("conflicts"):
        lines.append("冲突点：")
        for c in reasoning.get("conflicts", [])[:4]:
            lines.append(f"- 主题:{c.get('topic','')} | A:{c.get('a','')} | B:{c.get('b','')}")
    if reasoning.get("open_questions"):
        lines.append("待澄清问题：")
        for q in reasoning.get("open_questions", [])[:6]:
            lines.append(f"- {q}")
    lines.append("证据片段：")
    for c in chunks[:12]:
        lines.append(f"【chunk#{c.get('chunk_index')}】{(c.get('content') or '')[:260]}")

    text = "\n".join(lines).strip()
    if len(text) > max_chars:
        text = text[:max_chars]
    return text

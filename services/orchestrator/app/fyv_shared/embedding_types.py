"""Embedding 向量结果与检索场景类型。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

EmbeddingScenario = Literal["notes_ask", "podcast_reference", "default"]
EmbeddingRole = Literal["document", "query"]

DEFAULT_SCENARIO: EmbeddingScenario = "default"


@dataclass
class DocumentEmbeddings:
    dense: list[float]
    sparse: list[dict[str, Any]] = field(default_factory=list)

    def sparse_patch_for_meta(self) -> dict[str, Any]:
        if not self.sparse:
            return {}
        compact = []
        for item in self.sparse:
            if not isinstance(item, dict):
                continue
            idx = item.get("index")
            val = item.get("value")
            if idx is None or val is None:
                continue
            try:
                compact.append({"i": int(idx), "v": float(val)})
            except (TypeError, ValueError):
                continue
        return {"sparse_embedding": compact} if compact else {}

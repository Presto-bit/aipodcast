"""写作 Studio API（流式成稿/改版）。"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..composer_expert.manuscript_stream import iter_studio_manuscript_stream
from ..security import verify_internal_signature

router = APIRouter(
    prefix="/api/v1/studio",
    tags=["studio"],
    dependencies=[Depends(verify_internal_signature)],
)


def _current_user_ref_or_401(request: Request) -> str:
    from .. import auth_bridge

    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=401, detail="未登录")
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = auth_bridge.session_principal(sess)
    if not phone:
        raise HTTPException(status_code=401, detail="未登录")
    return phone


class StudioManuscriptStreamBody(BaseModel):
    task_sentence: str = Field(alias="taskSentence")
    intake: dict[str, Any] = Field(default_factory=dict)
    notebook: str = ""
    note_ids: list[str] = Field(default_factory=list, alias="noteIds")
    feature_core: dict[str, Any] = Field(default_factory=dict, alias="featureCore")
    style_prompt: str = Field(default="", alias="stylePrompt")
    author_prompt: str = Field(default="", alias="authorPrompt")
    use_rag: bool = Field(default=True, alias="useRag")
    rag_max_chars: int = Field(default=56000, alias="ragMaxChars")
    source_type: str = Field(default="composer_prompt", alias="sourceType")

    model_config = {"populate_by_name": True}


@router.post("/manuscript/stream")
def studio_manuscript_stream_api(body: StudioManuscriptStreamBody, request: Request):
    """Studio 成稿/改版 SSE：phase | blocks | done | error。"""
    user_ref = _current_user_ref_or_401(request)
    payload = body.model_dump(by_alias=True)
    payload["expertId"] = "xhs_ops"
    if payload.get("noteIds"):
        payload["source_type"] = "notes_rag"
        payload["selected_note_ids"] = payload["noteIds"]
        payload["notes_notebook"] = payload.get("notebook") or ""

    def gen():
        try:
            yield from iter_studio_manuscript_stream(payload=payload, user_ref=user_ref)
        except Exception as exc:
            yield "data: " + json.dumps({"type": "error", "message": str(exc)[:500]}, ensure_ascii=False) + "\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

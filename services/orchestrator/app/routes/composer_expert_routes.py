"""首页 Composer 专家模式 API。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..composer_expert.intake import run_composer_expert_intake
from ..security import verify_internal_signature

router = APIRouter(
    prefix="/api/v1/composer/expert",
    tags=["composer-expert"],
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


class ComposerExpertIntakeBody(BaseModel):
    expert_id: str = Field(alias="expertId")
    task_sentence: str = Field(alias="taskSentence")
    intake_step: int = Field(default=0, alias="intakeStep")
    intake: dict[str, Any] = Field(default_factory=dict)
    notebook: str | None = None
    note_count: int | None = Field(default=None, alias="noteCount")

    model_config = {"populate_by_name": True}


@router.post("/intake")
def composer_expert_intake_api(req: ComposerExpertIntakeBody, request: Request):
    _ = _current_user_ref_or_401(request)
    try:
        return run_composer_expert_intake(req.model_dump(by_alias=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

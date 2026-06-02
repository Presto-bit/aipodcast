"""个人特色 IP API（v6 笔记本风格最小集）。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from ..author_ip_materials import learn_author_ip
from ..author_ip_store import (
    ensure_author_ip_for_notebook,
    get_author_ip_by_notebook,
    get_default_author_ip,
    patch_author_ip,
    rename_author_ip_for_notebook,
)
from ..security import verify_internal_signature

router = APIRouter(
    prefix="/api/v1/author-ips",
    tags=["author-ip"],
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


class AuthorIpPatchBody(BaseModel):
    display_name: str | None = Field(default=None, max_length=120, alias="displayName")
    subtitle: str | None = Field(default=None, max_length=200)
    avatar_color: str | None = Field(default=None, max_length=40, alias="avatarColor")
    is_default: bool | None = Field(default=None, alias="isDefault")
    profile: dict[str, Any] | None = Field(default=None)

    model_config = {"populate_by_name": True}


class AuthorIpNotebookEnsureBody(BaseModel):
    notebook_name: str = Field(min_length=1, max_length=500, alias="notebookName")

    model_config = {"populate_by_name": True}


class AuthorIpNotebookRenameBody(BaseModel):
    notebook_name: str = Field(min_length=1, max_length=500, alias="notebookName")
    display_name: str = Field(min_length=1, max_length=120, alias="displayName")

    model_config = {"populate_by_name": True}


class AuthorIpLearnBody(BaseModel):
    mode: str = Field(default="full")
    note_ids: list[str] = Field(default_factory=list, alias="noteIds")

    model_config = {"populate_by_name": True}


def _raise_value_error(exc: ValueError) -> None:
    code = str(exc)
    if code == "ip_not_found":
        raise HTTPException(status_code=404, detail="not_found") from exc
    if code in ("read_only", "read_only_ip"):
        raise HTTPException(status_code=400, detail="read_only") from exc
    if code in ("note_ids_required", "no_learning_materials", "invalid_notebook"):
        raise HTTPException(status_code=400, detail=code) from exc
    raise HTTPException(status_code=400, detail=code) from exc


@router.get("/default")
def get_default_author_ip_api(request: Request):
    user_ref = _current_user_ref_or_401(request)
    item = get_default_author_ip(user_ref)
    if not item:
        return {"success": True, "item": None}
    return {"success": True, "item": item}


@router.get("/by-notebook")
def get_author_ip_by_notebook_api(
    request: Request,
    notebookName: str = Query(..., min_length=1, max_length=500),
):
    user_ref = _current_user_ref_or_401(request)
    item = get_author_ip_by_notebook(user_ref, notebookName)
    if not item:
        return {"success": True, "item": None}
    return {"success": True, "item": item}


@router.post("/by-notebook/ensure")
def ensure_author_ip_for_notebook_api(request: Request, body: AuthorIpNotebookEnsureBody):
    user_ref = _current_user_ref_or_401(request)
    try:
        item = ensure_author_ip_for_notebook(user_ref, body.notebook_name)
    except ValueError as exc:
        _raise_value_error(exc)
    return {"success": True, "item": item}


@router.patch("/by-notebook")
def rename_author_ip_for_notebook_api(request: Request, body: AuthorIpNotebookRenameBody):
    user_ref = _current_user_ref_or_401(request)
    item, err = rename_author_ip_for_notebook(
        user_ref,
        body.notebook_name,
        body.display_name,
    )
    if err:
        raise HTTPException(status_code=400, detail=err)
    if not item:
        raise HTTPException(status_code=404, detail="not_found")
    return {"success": True, "item": item}


@router.patch("/{ip_id}")
def patch_author_ip_api(request: Request, ip_id: str, body: AuthorIpPatchBody):
    user_ref = _current_user_ref_or_401(request)
    if (
        body.display_name is None
        and body.subtitle is None
        and body.avatar_color is None
        and body.is_default is None
        and body.profile is None
    ):
        raise HTTPException(status_code=400, detail="无效的请求")
    item, err = patch_author_ip(
        user_ref,
        ip_id,
        display_name=body.display_name,
        subtitle=body.subtitle,
        avatar_color=body.avatar_color,
        is_default=body.is_default,
        profile=body.profile,
    )
    if err:
        raise HTTPException(status_code=400, detail=err)
    if not item:
        raise HTTPException(status_code=404, detail="not_found")
    return {"success": True, "item": item}


@router.post("/{ip_id}/learn")
def learn_author_ip_api(request: Request, ip_id: str, body: AuthorIpLearnBody | None = None):
    user_ref = _current_user_ref_or_401(request)
    mode = (body.mode if body else "full") or "full"
    raw_ids = body.note_ids if body else []
    note_ids = [str(x).strip() for x in raw_ids if str(x).strip()] if raw_ids else None
    try:
        item = learn_author_ip(user_ref, ip_id, mode=mode, note_ids=note_ids)
    except ValueError as exc:
        _raise_value_error(exc)
    return {"success": True, "item": item}

"""个人特色 IP API。"""
from __future__ import annotations

from typing import Any

import json

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..author_ip_billing import can_afford_author_compose, debit_author_compose
from ..author_ip_store import (
    archive_author_ip,
    bootstrap_author_ips,
    create_blank_author_ip,
    duplicate_author_ip,
    ensure_author_ip_for_notebook,
    ensure_default_author_ip,
    get_author_ip,
    get_author_ip_by_notebook,
    list_archived_author_ips,
    list_author_ips,
    patch_author_ip,
    purge_author_ip,
    restore_author_ip,
)
from ..author_ip_materials import (
    add_author_ip_material,
    delete_author_ip_material,
    learn_author_ip,
    list_author_ip_materials,
    mark_author_ip_first_compare_shown,
    patch_author_ip_domains,
    patch_author_ip_material_learning,
    patch_author_ip_traits,
    refresh_author_ip_maturity,
    save_compose_to_ip_material,
    submit_author_ip_cold_start,
)
from ..author_ip_style import (
    _TARGET_CHARS,
    compose_author_article,
    iter_compose_author_article_events,
    record_style_feedback,
    resolve_author_style,
    trial_compose_author_snippet,
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


class AuthorIpCreateBody(BaseModel):
    display_name: str = Field(min_length=1, max_length=120, alias="displayName")
    subtitle: str = Field(default="", max_length=200)
    set_default: bool = Field(default=False, alias="setDefault")

    model_config = {"populate_by_name": True}


class AuthorIpPatchBody(BaseModel):
    display_name: str | None = Field(default=None, max_length=120, alias="displayName")
    subtitle: str | None = Field(default=None, max_length=200)
    avatar_color: str | None = Field(default=None, max_length=40, alias="avatarColor")
    is_default: bool | None = Field(default=None, alias="isDefault")

    model_config = {"populate_by_name": True}


class AuthorIpDuplicateBody(BaseModel):
    display_name: str | None = Field(default=None, max_length=120, alias="displayName")
    clone_notes: bool = Field(default=True, alias="cloneNotes")

    model_config = {"populate_by_name": True}


class AuthorIpStyleResolveBody(BaseModel):
    topic: str = Field(min_length=1, max_length=500)
    outline: str = Field(default="", max_length=4000)
    content_type: str = Field(default="article", alias="contentType")
    experience_level: str = Field(default="default", alias="experienceLevel")

    model_config = {"populate_by_name": True}


class AuthorIpComposeBody(BaseModel):
    topic: str = Field(min_length=1, max_length=500)
    outline: str = Field(default="", max_length=4000)
    content_type: str = Field(default="article", alias="contentType")
    use_author_style: bool = Field(default=True, alias="useAuthorStyle")
    experience_level: str = Field(default="default", alias="experienceLevel")
    target_chars: int | None = Field(default=None, alias="targetChars", ge=200, le=12000)

    model_config = {"populate_by_name": True}


class AuthorIpStyleFeedbackBody(BaseModel):
    liked: bool
    reason: str | None = Field(default=None, max_length=80)

    model_config = {"populate_by_name": True}


class AuthorIpColdStartBody(BaseModel):
    who_am_i: str = Field(default="", max_length=4000, alias="whoAmI")
    audience: str = Field(default="", max_length=4000)
    one_liner: str = Field(min_length=1, max_length=300, alias="oneLiner")
    traits: list[dict[str, Any]] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class AuthorIpMaterialCreateBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=120_000)
    material_type: str = Field(default="experience_card", alias="materialType")
    experience_template_id: str = Field(default="", alias="experienceTemplateId")

    model_config = {"populate_by_name": True}


class AuthorIpTrialComposeBody(BaseModel):
    topic: str = Field(min_length=1, max_length=300)
    content_type: str = Field(default="article", alias="contentType")

    model_config = {"populate_by_name": True}


class AuthorIpDomainsPatchBody(BaseModel):
    domains: list[dict[str, Any]] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class AuthorIpLearnBody(BaseModel):
    mode: str = Field(default="full")
    note_ids: list[str] = Field(default_factory=list, alias="noteIds")

    model_config = {"populate_by_name": True}


class AuthorIpTraitsPatchBody(BaseModel):
    traits: list[dict[str, Any]] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class AuthorIpMaterialLearningPatchBody(BaseModel):
    include_in_style_learning: bool = Field(alias="includeInStyleLearning")

    model_config = {"populate_by_name": True}


class AuthorIpComposeSaveBody(BaseModel):
    draft_body: str = Field(min_length=1, max_length=120_000, alias="draftBody")
    title: str | None = Field(default=None, max_length=200)
    topic: str | None = Field(default=None, max_length=500)
    save_as_published: bool = Field(default=True, alias="saveAsPublished")

    model_config = {"populate_by_name": True}


def _estimate_compose_chars(body: AuthorIpComposeBody) -> int:
    if body.target_chars:
        return int(body.target_chars)
    return int(_TARGET_CHARS.get(body.content_type, 1500))


def _assert_compose_billing(user_ref: str, estimated_chars: int) -> None:
    ok, msg, _meta = can_afford_author_compose(user_ref, estimated_chars)
    if not ok:
        raise HTTPException(status_code=402, detail=msg or "insufficient_wallet")


def _debit_after_compose(user_ref: str, body_text: str) -> dict[str, Any]:
    ok, msg, meta = debit_author_compose(user_ref, len(body_text or ""))
    if not ok:
        return {"billingWarning": msg or "debit_failed", **(meta or {})}
    return meta if isinstance(meta, dict) else {}


def _raise_value_error(exc: ValueError) -> None:
    code = str(exc)
    if code == "ip_not_found":
        raise HTTPException(status_code=404, detail="not_found") from exc
    if code in ("read_only", "read_only_ip"):
        raise HTTPException(status_code=400, detail="read_only") from exc
    if code in ("note_ids_required", "no_learning_materials", "invalid_notebook"):
        raise HTTPException(status_code=400, detail=code) from exc
    raise HTTPException(status_code=400, detail=code) from exc


@router.get("")
def list_author_ips_api(request: Request):
    user_ref = _current_user_ref_or_401(request)
    items = list_author_ips(user_ref)
    return {"success": True, "items": items}


@router.post("/ensure-default")
def ensure_default_author_ip_api(request: Request):
    user_ref = _current_user_ref_or_401(request)
    item = ensure_default_author_ip(user_ref)
    if not item:
        raise HTTPException(status_code=400, detail="ensure_default_failed")
    return {"success": True, "item": item}


@router.post("/bootstrap")
def bootstrap_author_ips_api(request: Request):
    """首次进入：默认 IP + 示例模板（含素材）；列表页仅需调用一次。"""
    user_ref = _current_user_ref_or_401(request)
    out = bootstrap_author_ips(user_ref)
    return {"success": True, "bootstrapped": True, **out}


class AuthorIpNotebookEnsureBody(BaseModel):
    notebook_name: str = Field(min_length=1, max_length=500, alias="notebookName")

    model_config = {"populate_by_name": True}


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


@router.post("")
def create_author_ip_api(request: Request, body: AuthorIpCreateBody):
    user_ref = _current_user_ref_or_401(request)
    item, err = create_blank_author_ip(
        user_ref,
        display_name=body.display_name,
        subtitle=body.subtitle,
        set_default=body.set_default,
    )
    if err or not item:
        raise HTTPException(status_code=400, detail=err or "create_failed")
    return {"success": True, "item": item}


@router.get("/trash")
def list_author_ips_trash_api(request: Request):
    user_ref = _current_user_ref_or_401(request)
    items = list_archived_author_ips(user_ref)
    return {"success": True, "items": items}


@router.get("/{ip_id}")
def get_author_ip_api(request: Request, ip_id: str):
    user_ref = _current_user_ref_or_401(request)
    item = get_author_ip(user_ref, ip_id)
    if not item:
        raise HTTPException(status_code=404, detail="not_found")
    return {"success": True, "item": item}


@router.patch("/{ip_id}")
def patch_author_ip_api(request: Request, ip_id: str, body: AuthorIpPatchBody):
    user_ref = _current_user_ref_or_401(request)
    item, err = patch_author_ip(
        user_ref,
        ip_id,
        display_name=body.display_name,
        subtitle=body.subtitle,
        avatar_color=body.avatar_color,
        is_default=body.is_default,
    )
    if err:
        raise HTTPException(status_code=400, detail=err)
    if not item:
        raise HTTPException(status_code=404, detail="not_found")
    return {"success": True, "item": item}


@router.delete("/{ip_id}")
def delete_author_ip_api(request: Request, ip_id: str):
    user_ref = _current_user_ref_or_401(request)
    ok, err = archive_author_ip(user_ref, ip_id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    if not ok:
        raise HTTPException(status_code=404, detail="not_found")
    return {"success": True}


@router.post("/{ip_id}/restore")
def restore_author_ip_api(request: Request, ip_id: str):
    user_ref = _current_user_ref_or_401(request)
    ok, err = restore_author_ip(user_ref, ip_id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    if not ok:
        raise HTTPException(status_code=404, detail="not_found")
    item = get_author_ip(user_ref, ip_id)
    return {"success": True, "item": item}


@router.post("/{ip_id}/purge")
def purge_author_ip_api(request: Request, ip_id: str):
    user_ref = _current_user_ref_or_401(request)
    ok, err = purge_author_ip(user_ref, ip_id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    if not ok:
        raise HTTPException(status_code=404, detail="not_found")
    return {"success": True}


@router.get("/{ip_id}/materials")
def list_author_ip_materials_api(request: Request, ip_id: str):
    user_ref = _current_user_ref_or_401(request)
    try:
        items = list_author_ip_materials(user_ref, ip_id)
    except ValueError as exc:
        _raise_value_error(exc)
    return {"success": True, "items": items}


@router.post("/{ip_id}/materials")
def create_author_ip_material_api(request: Request, ip_id: str, body: AuthorIpMaterialCreateBody):
    user_ref = _current_user_ref_or_401(request)
    try:
        item = add_author_ip_material(
            user_ref,
            ip_id,
            title=body.title,
            body=body.body,
            material_type=body.material_type,
            experience_template_id=body.experience_template_id,
        )
    except ValueError as exc:
        _raise_value_error(exc)
    return {"success": True, "item": item}


@router.delete("/{ip_id}/materials/{note_id}")
def delete_author_ip_material_api(request: Request, ip_id: str, note_id: str):
    user_ref = _current_user_ref_or_401(request)
    try:
        delete_author_ip_material(user_ref, ip_id, note_id)
    except ValueError as exc:
        _raise_value_error(exc)
    return {"success": True}


@router.post("/{ip_id}/cold-start")
def author_ip_cold_start_api(request: Request, ip_id: str, body: AuthorIpColdStartBody):
    user_ref = _current_user_ref_or_401(request)
    try:
        out = submit_author_ip_cold_start(
            user_ref,
            ip_id,
            who_am_i=body.who_am_i,
            audience=body.audience,
            one_liner=body.one_liner,
            traits=body.traits or None,
        )
    except ValueError as exc:
        _raise_value_error(exc)
    return {"success": True, **out}


@router.post("/{ip_id}/compose/save")
def save_author_ip_compose_api(request: Request, ip_id: str, body: AuthorIpComposeSaveBody):
    user_ref = _current_user_ref_or_401(request)
    try:
        saved = save_compose_to_ip_material(
            user_ref,
            ip_id,
            draft_body=body.draft_body,
            title=body.title,
            topic=body.topic,
            save_as_published=body.save_as_published,
        )
        item = refresh_author_ip_maturity(user_ref, ip_id)
    except ValueError as exc:
        _raise_value_error(exc)
    return {"success": True, "saved": saved, "item": item}


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


@router.patch("/{ip_id}/traits")
def patch_author_ip_traits_api(request: Request, ip_id: str, body: AuthorIpTraitsPatchBody):
    user_ref = _current_user_ref_or_401(request)
    try:
        item = patch_author_ip_traits(user_ref, ip_id, body.traits)
    except ValueError as exc:
        _raise_value_error(exc)
    return {"success": True, "item": item}


@router.patch("/{ip_id}/materials/{note_id}/learning")
def patch_author_ip_material_learning_api(
    request: Request,
    ip_id: str,
    note_id: str,
    body: AuthorIpMaterialLearningPatchBody,
):
    user_ref = _current_user_ref_or_401(request)
    try:
        result = patch_author_ip_material_learning(
            user_ref,
            ip_id,
            note_id,
            include_in_style_learning=body.include_in_style_learning,
        )
    except ValueError as exc:
        _raise_value_error(exc)
    return {"success": True, **result}


@router.post("/{ip_id}/style/resolve")
def resolve_author_style_api(request: Request, ip_id: str, body: AuthorIpStyleResolveBody):
    user_ref = _current_user_ref_or_401(request)
    try:
        resolved = resolve_author_style(
            user_ref,
            ip_id,
            topic=body.topic,
            outline=body.outline,
            content_type=body.content_type,
            experience_level=body.experience_level,
        )
    except ValueError as exc:
        code = str(exc)
        if code == "ip_not_found":
            raise HTTPException(status_code=404, detail="not_found") from exc
        raise HTTPException(status_code=400, detail=code) from exc
    return {"success": True, "resolver": resolved}


@router.get("/{ip_id}/compose/billing-preview")
def compose_billing_preview_api(
    request: Request,
    ip_id: str,
    target_chars: int | None = Query(default=None, alias="targetChars", ge=100, le=12000),
    content_type: str = Query(default="article", alias="contentType"),
):
    user_ref = _current_user_ref_or_401(request)
    if not get_author_ip(user_ref, ip_id):
        raise HTTPException(status_code=404, detail="not_found")
    chars = int(target_chars or _TARGET_CHARS.get(content_type, 1500))
    ok, msg, meta = can_afford_author_compose(user_ref, chars)
    return {"success": True, "canAfford": ok, "message": msg, "preview": meta}


@router.post("/{ip_id}/trial-compose")
def trial_compose_author_api(request: Request, ip_id: str, body: AuthorIpTrialComposeBody):
    user_ref = _current_user_ref_or_401(request)
    _assert_compose_billing(user_ref, 120)
    try:
        result = trial_compose_author_snippet(
            user_ref,
            ip_id,
            topic=body.topic,
            content_type=body.content_type,
        )
    except ValueError as exc:
        code = str(exc)
        if code == "ip_not_found":
            raise HTTPException(status_code=404, detail="not_found") from exc
        raise HTTPException(status_code=400, detail=code) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc) or "compose_failed") from exc
    billing = _debit_after_compose(user_ref, str(result.get("body") or ""))
    return {"success": True, **result, "billing": billing}


@router.patch("/{ip_id}/domains")
def patch_author_ip_domains_api(request: Request, ip_id: str, body: AuthorIpDomainsPatchBody):
    user_ref = _current_user_ref_or_401(request)
    try:
        item = patch_author_ip_domains(user_ref, ip_id, body.domains)
    except ValueError as exc:
        _raise_value_error(exc)
    return {"success": True, "item": item}


@router.post("/{ip_id}/first-compare/ack")
def ack_first_compare_api(request: Request, ip_id: str):
    user_ref = _current_user_ref_or_401(request)
    mark_author_ip_first_compare_shown(user_ref, ip_id)
    return {"success": True}


@router.post("/{ip_id}/compose")
def compose_author_article_api(request: Request, ip_id: str, body: AuthorIpComposeBody):
    user_ref = _current_user_ref_or_401(request)
    _assert_compose_billing(user_ref, _estimate_compose_chars(body))
    try:
        result = compose_author_article(
            user_ref,
            ip_id,
            topic=body.topic,
            outline=body.outline,
            content_type=body.content_type,
            use_author_style=body.use_author_style,
            experience_level=body.experience_level,
            target_chars=body.target_chars,
        )
    except ValueError as exc:
        code = str(exc)
        if code == "ip_not_found":
            raise HTTPException(status_code=404, detail="not_found") from exc
        if code == "topic_required":
            raise HTTPException(status_code=400, detail=code) from exc
        raise HTTPException(status_code=400, detail=code) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc) or "compose_failed") from exc
    billing = _debit_after_compose(user_ref, str(result.get("body") or ""))
    return {"success": True, **result, "billing": billing}


@router.post("/{ip_id}/compose/stream")
def compose_author_article_stream_api(request: Request, ip_id: str, body: AuthorIpComposeBody):
    user_ref = _current_user_ref_or_401(request)
    _assert_compose_billing(user_ref, _estimate_compose_chars(body))

    def gen():
        try:
            for ev in iter_compose_author_article_events(
                user_ref,
                ip_id,
                topic=body.topic,
                outline=body.outline,
                content_type=body.content_type,
                use_author_style=body.use_author_style,
                experience_level=body.experience_level,
                target_chars=body.target_chars,
            ):
                if ev.get("type") == "done" and ev.get("body"):
                    bill = _debit_after_compose(user_ref, str(ev.get("body") or ""))
                    ev = {**ev, "billing": bill}
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except ValueError as exc:
            code = str(exc)
            status = 404 if code == "ip_not_found" else 400
            err_ev = {"type": "error", "code": code, "status": status}
            yield f"data: {json.dumps(err_ev, ensure_ascii=False)}\n\n"
        except RuntimeError as exc:
            err_ev = {"type": "error", "code": str(exc) or "compose_failed", "status": 502}
            yield f"data: {json.dumps(err_ev, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.post("/{ip_id}/style/feedback")
def author_style_feedback_api(request: Request, ip_id: str, body: AuthorIpStyleFeedbackBody):
    user_ref = _current_user_ref_or_401(request)
    record_style_feedback(user_ref, ip_id, liked=body.liked, reason=body.reason)
    return {"success": True}


@router.post("/{ip_id}/duplicate")
def duplicate_author_ip_api(request: Request, ip_id: str, body: AuthorIpDuplicateBody | None = None):
    user_ref = _current_user_ref_or_401(request)
    payload = body or AuthorIpDuplicateBody()
    item, err = duplicate_author_ip(
        user_ref,
        ip_id,
        display_name=payload.display_name,
        clone_notes=payload.clone_notes,
    )
    if err:
        raise HTTPException(status_code=400, detail=err)
    if not item:
        raise HTTPException(status_code=404, detail="not_found")
    return {"success": True, "item": item}

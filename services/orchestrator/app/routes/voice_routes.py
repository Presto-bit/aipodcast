import os

from fastapi import APIRouter, Depends, HTTPException, Request

from .. import auth_bridge, voice_bridge
from ..models import list_saved_voices_for_user, replace_saved_voices_for_user
from ..provider_router import polish_tts_text, synthesize_tts
from ..schemas import PolishTtsTextRequest, PreviewVoiceRequest, SavedVoicesWriteRequest
from ..security import verify_internal_signature
from ..subscription_limits import tier_allows_ai_polish

router = APIRouter(prefix="/api/v1", tags=["voice"], dependencies=[Depends(verify_internal_signature)])


def _fyv_production() -> bool:
    return (os.environ.get("FYV_PRODUCTION") or "").strip().lower() in ("1", "true", "yes", "on")


def _raise_if_production_without_auth() -> None:
    """FYV_PRODUCTION=1 时必须启用登录，否则语音类接口无法按用户计费与限流。"""
    if _fyv_production() and not auth_bridge.is_auth_enabled():
        raise HTTPException(
            status_code=503,
            detail=(
                "配置错误：FYV_PRODUCTION=1 时必须启用登录鉴权，当前编排器未启用登录。"
                "请检查 fyv_auth / 相关环境变量与登录服务，或本地开发时关闭 FYV_PRODUCTION。"
            ),
        )


def _strict_user_phone(request: Request) -> str:
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=401, detail="未登录")
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = auth_bridge.session_principal(sess)
    if not phone:
        raise HTTPException(status_code=401, detail="未登录")
    return phone


@router.post("/saved_voices")
def save_saved_voices_api(body: SavedVoicesWriteRequest, request: Request):
    if auth_bridge.is_auth_enabled():
        phone = _strict_user_phone(request)
        ok, err, n = replace_saved_voices_for_user(phone, list(body.voices or []))
        if not ok:
            raise HTTPException(status_code=400, detail=err or "写入失败")
        return {"success": True, "count": n}
    ok, err = voice_bridge.save_saved_voices(list(body.voices or []))
    if not ok:
        raise HTTPException(status_code=500, detail=err or "写入失败")
    return {"success": True, "count": len(body.voices or [])}


@router.post("/preview_voice")
def preview_voice_api(body: PreviewVoiceRequest, request: Request):
    if auth_bridge.is_auth_enabled() or _fyv_production():
        _raise_if_production_without_auth()
        _strict_user_phone(request)
    api_key = str(os.getenv("MINIMAX_API_KEY") or "").strip() or None
    if not api_key:
        raise HTTPException(status_code=503, detail="服务端未配置 MINIMAX_API_KEY")
    text = (body.text or "").strip() or "欢迎收听我的播客节目"
    vid = (body.voice_id or "").strip()
    if not vid:
        raise HTTPException(status_code=400, detail="缺少 voice_id")
    try:
        tts = synthesize_tts(text[:500], voice_id=vid, api_key=api_key)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:500]) from exc
    return {
        "success": True,
        "audio_hex": tts.get("audio_hex"),
        "trace_id": tts.get("trace_id"),
        "voice_id": vid,
        "text_used": text[:500],
    }


@router.post("/polish_tts_text")
def polish_tts_text_api(body: PolishTtsTextRequest, request: Request):
    if auth_bridge.is_auth_enabled() or _fyv_production():
        _raise_if_production_without_auth()
        phone = _strict_user_phone(request)
        tier = "max"
        if not tier_allows_ai_polish(tier):
            raise HTTPException(
                status_code=403,
                detail="当前套餐不含 AI 润色权益（或运营已关闭 AI_POLISH_FEATURE_ENABLED）",
            )
    api_key = str(os.getenv("MINIMAX_API_KEY") or "").strip() or None
    if not api_key:
        raise HTTPException(status_code=503, detail="服务端未配置 MINIMAX_API_KEY")
    mode = str(body.tts_mode or "single").strip().lower()
    if mode not in ("single", "dual"):
        mode = "single"
    out = polish_tts_text((body.text or "").strip(), api_key=api_key, tts_mode=mode)
    if not out.get("success"):
        raise HTTPException(status_code=500, detail=str(out.get("error") or "polish_failed")[:500])
    return {"success": True, "text": str(out.get("text") or "").strip(), "trace_id": out.get("trace_id")}


@router.get("/default-voices")
def default_voices_api():
    return {
        "success": True,
        "voices": voice_bridge.get_default_voices(),
        "system_voices": voice_bridge.get_system_voices(),
    }


@router.get("/saved_voices")
def saved_voices_api(request: Request):
    if auth_bridge.is_auth_enabled():
        phone = _strict_user_phone(request)
        return {"success": True, "voices": list_saved_voices_for_user(phone)}
    return {"success": True, "voices": voice_bridge.get_saved_voices()}

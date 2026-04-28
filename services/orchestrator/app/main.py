"""编排器 HTTP 入口：路由按域拆分到 `app/routes/`。"""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from .config import settings
from .embedded_rq_ai import start_embedded_ai_rq_worker_thread
from .embedded_rq_media import start_embedded_media_rq_worker_thread
from .e2e_smoke import e2e_smoke_secret_configured
from .clip_store import ensure_clip_studio_schema
from .models import (
    ensure_payment_order_items_schema,
    ensure_payment_refunds_schema,
    ensure_payment_orders_schema,
    ensure_payment_transactions_schema,
    ensure_payment_webhook_deliveries_schema,
    ensure_saved_voices_schema,
    ensure_subscription_current_state_schema,
    ensure_subscription_events_schema,
    ensure_usage_events_user_id_schema,
    ensure_user_payg_minute_grants_schema,
    ensure_user_preferences_schema,
    ensure_user_wallet_schema,
    ensure_users_profile_columns,
    ensure_alipay_page_checkout_schema,
    ensure_payment_reconciliation_queue_schema,
    purge_expired_trashed_notes,
    purge_expired_trashed_works,
    strip_redundant_audio_hex_from_job_results,
)
from .object_store import ensure_bucket_exists, log_object_presign_endpoint_warnings
from .startup_payment_checks import run_payment_startup_checks
from .startup_security import assert_production_security_or_exit
from .middleware.request_id import RequestIdMiddleware
from .rss_publish_store import ensure_rss_publish_schema
from .routes import (
    admin_routes,
    auth_routes,
    clip_routes,
    e2e_smoke_routes,
    health,
    jobs_routes,
    notes_routes,
    rss_routes,
    search_routes,
    subscription_routes,
    user_prefs_routes,
    voice_routes,
    webhooks_routes,
)

logger = logging.getLogger(__name__)


def _request_id_from_request(request: Request) -> str:
    rid = getattr(request.state, "request_id", None)
    return str(rid or "").strip()


def _error_payload(
    *,
    request: Request,
    error: str,
    detail: str,
    status_code: int,
) -> dict[str, object]:
    rid = _request_id_from_request(request)
    payload: dict[str, object] = {
        "success": False,
        "error": error,
        "detail": detail,
        "status_code": int(status_code),
    }
    if rid:
        payload["request_id"] = rid
        payload["requestId"] = rid
    return payload


def _startup_step(label: str, fn: Callable[[], None]) -> None:
    try:
        fn()
    except Exception:
        logger.exception("orchestrator startup failed: %s", label)
        if settings.strict_schema_startup:
            raise


def _run_bootstrap_admin_if_enabled() -> None:
    """FYV_BOOTSTRAP_ADMIN_ENABLED=1 时创建/提升运维管理员（见 .env.ai-native.example）。"""
    from .fyv_shared.auth_service import ensure_bootstrap_admin

    ok, msg = ensure_bootstrap_admin()
    if msg == "bootstrap_admin_disabled":
        return
    if ok:
        logger.info("bootstrap admin: %s", msg)
    else:
        logger.warning("bootstrap admin: %s", msg)


def run_startup_tasks() -> None:
    """
    编排器进程级初始化：含支付/钱包相关表的幂等 DDL。
    业务热路径（如 process_payment_event_transaction）依赖此处已执行，不再逐请求 ensure_*，
    以避免重复访问 PostgreSQL catalog。若在无 lifespan 的环境直接调用 models 支付写入函数，
    须先手动执行对应 ensure_* 或应用 infra/postgres/init 迁移。
    """
    assert_production_security_or_exit()
    _startup_step("object_store.ensure_bucket_exists", ensure_bucket_exists)
    try:
        log_object_presign_endpoint_warnings()
    except Exception:
        logger.exception("object_store.log_object_presign_endpoint_warnings failed")
    notes_routes.ensure_notebooks_schema_startup(strict=settings.strict_schema_startup)
    jobs_routes.ensure_jobs_trash_schema_startup(strict=settings.strict_schema_startup)
    _startup_step("ensure_saved_voices_schema", ensure_saved_voices_schema)
    _startup_step("ensure_user_preferences_schema", ensure_user_preferences_schema)
    _startup_step("ensure_users_profile_columns", ensure_users_profile_columns)
    _startup_step("ensure_bootstrap_admin", _run_bootstrap_admin_if_enabled)
    _startup_step("ensure_subscription_events_schema", ensure_subscription_events_schema)
    _startup_step("ensure_usage_events_user_id_schema", ensure_usage_events_user_id_schema)
    _startup_step("ensure_payment_orders_schema", ensure_payment_orders_schema)
    _startup_step("ensure_payment_order_items_schema", ensure_payment_order_items_schema)
    _startup_step("ensure_payment_transactions_schema", ensure_payment_transactions_schema)
    _startup_step("ensure_payment_refunds_schema", ensure_payment_refunds_schema)
    _startup_step("ensure_user_wallet_schema", ensure_user_wallet_schema)
    _startup_step("ensure_user_payg_minute_grants_schema", ensure_user_payg_minute_grants_schema)
    _startup_step(
        "ensure_payment_webhook_deliveries_schema",
        ensure_payment_webhook_deliveries_schema,
    )
    _startup_step(
        "ensure_payment_reconciliation_queue_schema",
        ensure_payment_reconciliation_queue_schema,
    )
    _startup_step(
        "ensure_subscription_current_state_schema",
        ensure_subscription_current_state_schema,
    )
    _startup_step("ensure_alipay_page_checkout_schema", ensure_alipay_page_checkout_schema)
    try:
        run_payment_startup_checks()
    except Exception:
        logger.exception("run_payment_startup_checks")
    _startup_step("ensure_rss_publish_schema", ensure_rss_publish_schema)
    _startup_step("ensure_clip_studio_schema", lambda: ensure_clip_studio_schema(strict=settings.strict_schema_startup))


def _run_scheduled_storage_maintenance() -> None:
    """回收站到期清理 + 历史任务 result 中冗余 audio_hex 剥离（对象存储已有时）。"""
    try:
        n_notes = purge_expired_trashed_notes(
            retention_days=settings.trash_retention_days,
            max_rows=settings.trash_purge_max_rows,
        )
        n_jobs = purge_expired_trashed_works(
            retention_days=settings.trash_retention_days,
            max_rows=settings.trash_purge_max_rows,
        )
        n_hex = strip_redundant_audio_hex_from_job_results(max_rows=settings.trash_purge_max_rows)
        if n_notes or n_jobs or n_hex:
            logger.info(
                "scheduled storage maintenance: trashed_notes=%s trashed_jobs=%s stripped_audio_hex_rows=%s",
                n_notes,
                n_jobs,
                n_hex,
            )
    except Exception:
        logger.exception("scheduled storage maintenance failed")


async def _scheduled_storage_maintenance_loop(stop: asyncio.Event) -> None:
    interval = int(settings.trash_purge_interval_sec)
    if interval <= 0:
        return
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=float(interval))
        except asyncio.TimeoutError:
            pass
        if stop.is_set():
            break
        await asyncio.to_thread(_run_scheduled_storage_maintenance)


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    run_startup_tasks()
    if settings.embed_rq_media_worker:
        try:
            start_embedded_media_rq_worker_thread(settings.redis_url)
        except Exception:
            logger.exception("embedded media RQ worker failed to start; podcast jobs may stay queued until media-worker runs")
    if settings.embed_rq_ai_worker:
        try:
            start_embedded_ai_rq_worker_thread(settings.redis_url)
        except Exception:
            logger.exception(
                "embedded ai RQ worker failed to start; ai-queue jobs may stay queued until ai-worker runs"
            )
    stop = asyncio.Event()
    maint_task: asyncio.Task[None] | None = None
    if int(settings.trash_purge_interval_sec) > 0:
        maint_task = asyncio.create_task(_scheduled_storage_maintenance_loop(stop))
    try:
        yield
    finally:
        stop.set()
        if maint_task is not None:
            try:
                await asyncio.wait_for(maint_task, timeout=5.0)
            except Exception:
                maint_task.cancel()


app = FastAPI(title="AI Native Orchestrator", version="0.1.0", lifespan=_lifespan)
app.add_middleware(RequestIdMiddleware)


def _safe_request_path(request: Request) -> str:
    p = request.scope.get("path")
    if isinstance(p, str) and p:
        return p
    raw = request.scope.get("raw_path", b"")
    if isinstance(raw, (bytes, bytearray)):
        return bytes(raw).decode("latin-1", errors="replace")
    return "/"


@app.exception_handler(HTTPException)
async def _alipay_webhook_plaintext_auth_errors(request: Request, exc: HTTPException):
    """
    支付宝异步通知要求响应体为 success/fail 等纯文本；内部签名校验失败时默认 JSON 不利于对方重试与排障。
    """
    path = (_safe_request_path(request) or "").rstrip("/")
    if path.endswith("/webhooks/alipay") and exc.status_code in (401, 403):
        return PlainTextResponse("fail", status_code=exc.status_code, headers=dict(exc.headers or {}))
    detail = str(exc.detail or "request_failed")
    rid = _request_id_from_request(request) or "-"
    logger.warning(
        "http_error request_id=%s status=%s method=%s path=%s detail=%s",
        rid,
        exc.status_code,
        request.method,
        _safe_request_path(request),
        detail[:300],
    )
    return JSONResponse(
        content=_error_payload(
            request=request,
            error="http_exception",
            detail=detail,
            status_code=exc.status_code,
        ),
        status_code=exc.status_code,
        headers=dict(exc.headers or {}),
    )


@app.exception_handler(UnicodeDecodeError)
async def _unicode_decode_error_json(request: Request, exc: UnicodeDecodeError):
    rid = _request_id_from_request(request) or "-"
    reason = str(exc).replace("\n", " ").strip()[:260]
    logger.warning(
        "unicode_decode_error request_id=%s method=%s path=%s detail=%s",
        rid,
        request.method,
        _safe_request_path(request),
        reason,
    )
    detail = "invalid_text_encoding:文件或参数编码不兼容，请使用 UTF-8（文本）或重新导出后重试"
    if reason:
        detail = f"{detail}（原因：{reason}）"
    if rid and rid != "-":
        detail = f"{detail}（request_id={rid}）"
    return JSONResponse(
        content=_error_payload(
            request=request,
            error="invalid_text_encoding",
            detail=detail,
            status_code=400,
        ),
        status_code=400,
    )


@app.exception_handler(Exception)
async def _unhandled_exception_json(request: Request, exc: Exception):
    rid = _request_id_from_request(request) or "-"
    logger.exception(
        "unhandled_error request_id=%s method=%s path=%s",
        rid,
        request.method,
        _safe_request_path(request),
    )
    err_msg = str(exc or "").strip().replace("\n", " ")[:220]
    detail = f"internal_server_error:{exc.__class__.__name__}"
    if err_msg:
        detail = f"{detail}:{err_msg}"
    return JSONResponse(
        content=_error_payload(
            request=request,
            error="internal_server_error",
            detail=detail,
            status_code=500,
        ),
        status_code=500,
    )


app.include_router(health.router)
app.include_router(auth_routes.router)
app.include_router(user_prefs_routes.router)
app.include_router(clip_routes.router)
app.include_router(jobs_routes.router)
app.include_router(notes_routes.router)
app.include_router(voice_routes.router)
app.include_router(subscription_routes.router)
app.include_router(admin_routes.router)
app.include_router(search_routes.router)
app.include_router(webhooks_routes.router)
app.include_router(rss_routes.private_router)
app.include_router(rss_routes.public_router)
if e2e_smoke_secret_configured():
    app.include_router(e2e_smoke_routes.router)

"""编排器 HTTP 入口：路由按域拆分到 `app/routes/`。"""

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import settings
from .models import (
    ensure_payment_refunds_schema,
    ensure_payment_orders_schema,
    ensure_payment_webhook_deliveries_schema,
    ensure_saved_voices_schema,
    ensure_subscription_current_state_schema,
    ensure_subscription_events_schema,
    ensure_user_preferences_schema,
    ensure_users_profile_columns,
    ensure_wechat_native_checkout_schema,
)
from .object_store import ensure_bucket_exists
from .rss_publish_store import ensure_rss_publish_schema
from .routes import (
    admin_routes,
    auth_routes,
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


def _startup_step(label: str, fn: Callable[[], None]) -> None:
    try:
        fn()
    except Exception:
        logger.exception("orchestrator startup failed: %s", label)
        if settings.strict_schema_startup:
            raise


def run_startup_tasks() -> None:
    _startup_step("object_store.ensure_bucket_exists", ensure_bucket_exists)
    notes_routes.ensure_notebooks_schema_startup(strict=settings.strict_schema_startup)
    jobs_routes.ensure_jobs_trash_schema_startup(strict=settings.strict_schema_startup)
    _startup_step("ensure_saved_voices_schema", ensure_saved_voices_schema)
    _startup_step("ensure_user_preferences_schema", ensure_user_preferences_schema)
    _startup_step("ensure_users_profile_columns", ensure_users_profile_columns)
    _startup_step("ensure_subscription_events_schema", ensure_subscription_events_schema)
    _startup_step("ensure_payment_orders_schema", ensure_payment_orders_schema)
    _startup_step(
        "ensure_payment_webhook_deliveries_schema",
        ensure_payment_webhook_deliveries_schema,
    )
    _startup_step(
        "ensure_subscription_current_state_schema",
        ensure_subscription_current_state_schema,
    )
    _startup_step("ensure_payment_refunds_schema", ensure_payment_refunds_schema)
    _startup_step("ensure_wechat_native_checkout_schema", ensure_wechat_native_checkout_schema)
    _startup_step("ensure_rss_publish_schema", ensure_rss_publish_schema)


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    run_startup_tasks()
    yield


app = FastAPI(title="AI Native Orchestrator", version="0.1.0", lifespan=_lifespan)

app.include_router(health.router)
app.include_router(auth_routes.router)
app.include_router(user_prefs_routes.router)
app.include_router(jobs_routes.router)
app.include_router(notes_routes.router)
app.include_router(voice_routes.router)
app.include_router(subscription_routes.router)
app.include_router(admin_routes.router)
app.include_router(search_routes.router)
app.include_router(webhooks_routes.router)
app.include_router(rss_routes.private_router)
app.include_router(rss_routes.public_router)

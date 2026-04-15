import os
from dotenv import load_dotenv


_APP_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_APP_DIR, "../../.."))
load_dotenv(os.path.join(_REPO_ROOT, ".env.ai-native"), override=False)
load_dotenv(".env.ai-native", override=False)


def _fyv_production() -> bool:
    return (os.environ.get("FYV_PRODUCTION") or "").strip().lower() in ("1", "true", "yes", "on")


def _parse_embed_rq_media_worker() -> bool:
    """
    ORCHESTRATOR_EMBED_RQ_MEDIA_WORKER：
    - 显式 1/true/on → 内嵌 media 消费者；
    - 显式 0/false/off → 不内嵌；
    - 未设置 → FYV_PRODUCTION 未开启时默认内嵌（本机只起编排器时播客可出队）。
    """
    raw = (os.environ.get("ORCHESTRATOR_EMBED_RQ_MEDIA_WORKER") or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return not _fyv_production()


class Settings:
    db_host = os.getenv("DB_HOST", "127.0.0.1")
    db_port = int(os.getenv("DB_PORT", "5432"))
    db_name = os.getenv("DB_NAME", "aipodcast")
    db_user = os.getenv("DB_USER", "aipodcast")
    db_password = os.getenv("DB_PASSWORD", "aipodcast")

    redis_url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")

    object_endpoint = os.getenv("OBJECT_ENDPOINT", "http://127.0.0.1:9000")
    object_region = os.getenv("OBJECT_REGION", "us-east-1")
    object_access_key = os.getenv("OBJECT_ACCESS_KEY", "minioadmin")
    object_secret_key = os.getenv("OBJECT_SECRET_KEY", "minioadmin")
    object_bucket = os.getenv("OBJECT_BUCKET", "aipodcast-artifacts")
    object_force_path_style = os.getenv("OBJECT_FORCE_PATH_STYLE", "1") in ("1", "true", "True")

    orchestrator_port = int(os.getenv("ORCHESTRATOR_PORT", "8008"))
    orchestrator_api_token = os.getenv("ORCHESTRATOR_API_TOKEN", "local-dev-token")
    internal_signing_secret = os.getenv("INTERNAL_SIGNING_SECRET", "local-internal-secret")

    # 生产建议设为 1：任一启动期 DDL/存储就绪步骤失败则进程退出，避免带病运行。
    strict_schema_startup = os.getenv("ORCHESTRATOR_STRICT_SCHEMA", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )

    # 回收站保留天数；定时任务与 API 侧 purge 共用。
    trash_retention_days = max(1, min(365, int(os.getenv("TRASH_RETENTION_DAYS", "7"))))
    # 后台回收站清理间隔（秒）；0 表示不启用独立定时循环（仍可在启动与各 API 路径触发 purge）。
    trash_purge_interval_sec = max(0, int(os.getenv("TRASH_PURGE_INTERVAL_SEC", "3600")))
    trash_purge_max_rows = max(1, min(2000, int(os.getenv("TRASH_PURGE_MAX_ROWS", "500"))))

    # 非生产默认在进程内消费 media 队列；生产须 FYV_PRODUCTION=1（此时默认关）并部署独立 media-worker
    embed_rq_media_worker = _parse_embed_rq_media_worker()


settings = Settings()

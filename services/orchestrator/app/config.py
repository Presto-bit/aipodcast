import os
from dotenv import load_dotenv


_APP_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_APP_DIR, "../../.."))
load_dotenv(os.path.join(_REPO_ROOT, ".env.ai-native"), override=False)
load_dotenv(".env.ai-native", override=False)


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


settings = Settings()

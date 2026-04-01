"""测试前设置环境变量，避免导入 main 时连接真实服务失败。"""
import os

os.environ.setdefault("DB_HOST", "127.0.0.1")
os.environ.setdefault("DB_PORT", "5432")
os.environ.setdefault("DB_NAME", "test")
os.environ.setdefault("DB_USER", "test")
os.environ.setdefault("DB_PASSWORD", "test")
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:6379/15")

from __future__ import annotations

import logging
import os

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from typing import Any
from urllib.parse import unquote, urlparse

from .config import settings
from .internal_storage_url import (
    is_likely_internal_object_store_http_url,
    sanitize_job_result_media_urls_for_browser,
    strip_internal_object_store_http_url,
)


def object_key_from_storage_http_url(url: str) -> str | None:
    """
    从 path-style 对象 URL 解析出 S3 Key（与 settings.object_bucket 一致的前缀）。
    用于修复误持久化的内网 MinIO 直链（如 http://minio:9000/aipodcast-artifacts/jobs/u/...），
    浏览器无法访问该 Host，但编排器可用解析出的 key 经 get_object / 预签名对外提供。
    """
    u = (url or "").strip()
    if not u.startswith(("http://", "https://")):
        return None
    try:
        parsed = urlparse(u)
    except Exception:
        return None
    path = unquote((parsed.path or "").strip())
    if not path.startswith("/"):
        return None
    rest = path.lstrip("/")
    b = (settings.object_bucket or "").strip()
    if not b or not rest.startswith(b + "/"):
        return None
    key = rest[len(b) :].lstrip("/")
    return key or None


def resolve_job_audio_object_key_from_result(result: dict[str, Any]) -> str:
    """优先 result.audio_object_key；否则从误存的 path-style audio_url 推断。"""
    k = str(result.get("audio_object_key") or "").strip()
    if k:
        return k
    inferred = object_key_from_storage_http_url(str(result.get("audio_url") or ""))
    return (inferred or "").strip()


logger = logging.getLogger(__name__)


def _presign_effective_endpoint() -> str:
    return ((settings.object_presign_endpoint or "").strip() or settings.object_endpoint or "").strip()


def log_object_presign_endpoint_warnings() -> None:
    """
    生产环境启动时提示 OBJECT_PRESIGN_ENDPOINT 配置；不抛异常，避免误拦本机 smoke。
    FYV_PRODUCTION=1 且预签名实际仍指向内网 / 明文 http 时打 WARNING。
    """
    prod = (os.environ.get("FYV_PRODUCTION") or "").strip().lower() in ("1", "true", "yes", "on")
    if not prod:
        return
    pres = (settings.object_presign_endpoint or "").strip()
    raw_ep = (settings.object_endpoint or "").strip()
    effective = _presign_effective_endpoint()
    try:
        parsed = urlparse(effective)
        host = (parsed.hostname or "").lower()
        scheme = (parsed.scheme or "").lower()
    except Exception:
        host, scheme = "", ""
    internal_host = host in ("minio", "localhost", "127.0.0.1", "::1") or host.endswith(".svc.cluster.local")
    if not pres and internal_host:
        logger.warning(
            "object_presign: FYV_PRODUCTION=1 且未设置 OBJECT_PRESIGN_ENDPOINT，"
            "预签名将使用 OBJECT_ENDPOINT（%s）。浏览器、RSS enclosure 与外部拉取无法使用该 Host；"
            "请在 HTTPS 反代 MinIO API 的公网域名上设置 OBJECT_PRESIGN_ENDPOINT=https://…（读写仍用内网 OBJECT_ENDPOINT）。",
            raw_ep[:120],
        )
    elif pres and scheme == "http" and host not in ("localhost", "127.0.0.1", "::1"):
        logger.warning(
            "object_presign: OBJECT_PRESIGN_ENDPOINT 为明文 http（%s）；对外 HTTPS 站点易出现混合内容，建议改为 https://",
            pres[:120],
        )


def _s3():
    return boto3.client(
        "s3",
        endpoint_url=settings.object_endpoint,
        aws_access_key_id=settings.object_access_key,
        aws_secret_access_key=settings.object_secret_key,
        region_name=settings.object_region,
        config=Config(s3={"addressing_style": "path" if settings.object_force_path_style else "auto"}),
    )


def _s3_for_presigned_url():
    """仅用于 generate_presigned_url：公网域名须与百炼可访问的 Host 一致（如 https://prestoai.cn）。"""
    ep = (settings.object_presign_endpoint or "").strip() or settings.object_endpoint
    return boto3.client(
        "s3",
        endpoint_url=ep,
        aws_access_key_id=settings.object_access_key,
        aws_secret_access_key=settings.object_secret_key,
        region_name=settings.object_region,
        config=Config(s3={"addressing_style": "path" if settings.object_force_path_style else "auto"}),
    )


def ensure_bucket_exists() -> None:
    s3 = _s3()
    try:
        s3.head_bucket(Bucket=settings.object_bucket)
    except ClientError:
        s3.create_bucket(Bucket=settings.object_bucket)


def object_store_reachable() -> str:
    """
    就绪检查：能否访问配置中的 bucket（不创建 bucket）。
    返回 'ok' 或截断后的错误说明。
    """
    try:
        _s3().head_bucket(Bucket=settings.object_bucket)
        return "ok"
    except ClientError as e:
        msg = str(e) or e.__class__.__name__
        return f"error: {msg[:200]}"
    except Exception as e:
        msg = str(e) or e.__class__.__name__
        return f"error: {msg[:200]}"


def upload_text(object_key: str, text: str) -> str:
    s3 = _s3()
    s3.put_object(
        Bucket=settings.object_bucket,
        Key=object_key,
        Body=text.encode("utf-8"),
        ContentType="text/plain; charset=utf-8",
    )
    return object_key


def upload_bytes(object_key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    s3 = _s3()
    s3.put_object(Bucket=settings.object_bucket, Key=object_key, Body=data, ContentType=content_type)
    return object_key


def get_object_bytes(object_key: str) -> bytes:
    s3 = _s3()
    obj = s3.get_object(Bucket=settings.object_bucket, Key=object_key)
    return obj["Body"].read()


def iter_object_chunks(object_key: str, *, chunk_size: int = 262_144):
    """流式读取对象体（用于同源代理波形/试听，减轻单次内存）。"""
    key = (object_key or "").strip()
    if not key:
        raise ValueError("object_key_empty")
    sz = max(32_768, min(8 * 1024 * 1024, int(chunk_size)))
    s3 = _s3()
    obj = s3.get_object(Bucket=settings.object_bucket, Key=key)
    for chunk in obj["Body"].iter_chunks(chunk_size=sz):
        if chunk:
            yield chunk


def head_object_byte_length(object_key: str) -> int:
    """对象大小（字节），用于 Content-Length / Range。"""
    key = (object_key or "").strip()
    if not key:
        raise ValueError("object_key_empty")
    s3 = _s3()
    r = s3.head_object(Bucket=settings.object_bucket, Key=key)
    return int(r["ContentLength"])


def iter_object_byte_range(object_key: str, start: int, end_inclusive: int, *, chunk_size: int = 262_144):
    """S3 Range 读取；end_inclusive 含端点（与 HTTP Content-Range 一致）。"""
    key = (object_key or "").strip()
    if not key:
        raise ValueError("object_key_empty")
    if end_inclusive < start or start < 0:
        raise ValueError("invalid_range")
    rng = f"bytes={start}-{end_inclusive}"
    sz = max(32_768, min(8 * 1024 * 1024, int(chunk_size)))
    s3 = _s3()
    obj = s3.get_object(Bucket=settings.object_bucket, Key=key, Range=rng)
    for chunk in obj["Body"].iter_chunks(chunk_size=sz):
        if chunk:
            yield chunk


def presigned_get_url(object_key: str, *, expires_in: int = 3600) -> str:
    """
    生成对象 GET 的预签名 URL，便于客户端直拉 MP3/封面/视频，减轻编排器流式代理压力。
    expires_in：秒，S3/MinIO 常见上限 7 天以内（视配置而定）。
    """
    key = (object_key or "").strip()
    if not key:
        raise ValueError("object_key_empty")
    exp = int(expires_in)
    if exp < 60:
        raise ValueError("expires_in_too_small")
    if exp > 86400 * 7:
        exp = 86400 * 7
    return _s3_for_presigned_url().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.object_bucket, "Key": key},
        ExpiresIn=exp,
    )


def delete_object_key(object_key: str) -> bool:
    """删除对象存储中的单个 key；不存在或失败时返回 False（调用方可忽略）。"""
    key = (object_key or "").strip()
    if not key:
        return False
    try:
        s3 = _s3()
        s3.delete_object(Bucket=settings.object_bucket, Key=key)
        return True
    except ClientError:
        return False

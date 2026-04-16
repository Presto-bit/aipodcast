import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from .config import settings


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

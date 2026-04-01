import hashlib
import hmac
from fastapi import Header, HTTPException

from .config import settings


def verify_bearer_token(authorization: str = Header(default="")) -> None:
    token = authorization.replace("Bearer ", "").strip()
    if not token or token != settings.orchestrator_api_token:
        raise HTTPException(status_code=401, detail="invalid_token")


def verify_internal_signature(
    x_internal_signature: str = Header(default=""),
    x_internal_timestamp: str = Header(default=""),
    x_internal_payload_sha256: str = Header(default=""),
) -> None:
    # BFF gateway signs "timestamp:payload_sha256"
    if not x_internal_signature or not x_internal_timestamp or not x_internal_payload_sha256:
        raise HTTPException(status_code=401, detail="missing_internal_signature")
    message = f"{x_internal_timestamp}:{x_internal_payload_sha256}".encode("utf-8")
    expected = hmac.new(
        settings.internal_signing_secret.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, x_internal_signature):
        raise HTTPException(status_code=401, detail="invalid_internal_signature")

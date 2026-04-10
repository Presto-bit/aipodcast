"""请求关联 ID：透传或生成 X-Request-ID，可选一行访问日志。"""

from __future__ import annotations

import logging
import os
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

_access = logging.getLogger("fyv.access")


class RequestIdMiddleware(BaseHTTPMiddleware):
    """从 X-Request-ID / X-Correlation-ID 继承，否则生成 UUID；响应头回写。"""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        incoming = (
            (request.headers.get("x-request-id") or request.headers.get("x-correlation-id") or "").strip()
        )
        rid = incoming or str(uuid.uuid4())
        request.state.request_id = rid
        t0 = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        if (os.environ.get("FYV_HTTP_ACCESS_LOG") or "").strip().lower() in ("1", "true", "yes", "on"):
            ms = (time.perf_counter() - t0) * 1000.0
            _access.info(
                "request_id=%s %s %s -> %s %.1fms",
                rid,
                request.method,
                request.url.path,
                response.status_code,
                ms,
            )
        return response

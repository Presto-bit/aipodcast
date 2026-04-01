"""编排器 /health 响应结构（mock DB/Redis/RQ，不依赖真实服务）。"""
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest

pytest.importorskip("psycopg2")
from fastapi.testclient import TestClient


@contextmanager
def _fake_conn():
    yield MagicMock()


@contextmanager
def _fake_cursor(_conn):
    cur = MagicMock()
    yield cur


class _FakeQueue:
    def __len__(self) -> int:
        return 0


@pytest.fixture
def client():
    from app.routes import health as health_routes

    with (
        patch.object(health_routes, "get_conn", _fake_conn),
        patch.object(health_routes, "get_cursor", _fake_cursor),
        patch.object(health_routes, "object_store_reachable", return_value="ok"),
        patch.object(health_routes, "redis_conn") as mr,
        patch.object(health_routes, "ai_queue", _FakeQueue()),
        patch.object(health_routes, "media_queue", _FakeQueue()),
    ):
        mr.ping.return_value = True
        from app.main import app

        yield TestClient(app)


def test_health_returns_json(client: TestClient):
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert "ok" in data
    assert data.get("postgres") == "ok"
    assert data.get("redis") == "ok"
    assert data.get("object_store") == "ok"
    assert "queues" in data

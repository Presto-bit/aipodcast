"""编排器 /health 响应结构（mock DB/Redis/RQ，不依赖真实服务）。"""
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest

pytest.importorskip("psycopg2")
from fastapi.testclient import TestClient

pytest.importorskip("rq")


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


class _FakeMediaQueueBusy:
    name = "media"

    def __len__(self) -> int:
        return 2


@pytest.fixture
def client():
    from app.routes import health as health_routes

    class _RqWorkerStub:
        @staticmethod
        def count(connection=None, queue=None):  # noqa: ARG004
            return 1

    with (
        patch.object(health_routes, "get_conn", _fake_conn),
        patch.object(health_routes, "get_cursor", _fake_cursor),
        patch.object(health_routes, "object_store_reachable", return_value="ok"),
        patch.object(health_routes, "redis_conn") as mr,
        patch.object(health_routes, "ai_queue", _FakeQueue()),
        patch.object(health_routes, "media_queue", _FakeQueue()),
        patch.object(health_routes, "RqWorker", _RqWorkerStub),
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
    assert data.get("rq_workers") == {"media": 1, "ai": 1}
    assert "queue_alerts" not in data


def test_health_queue_alerts_when_media_pending_but_no_worker():
    from app.config import settings as orch_settings
    from app.main import app
    from app.routes import health as health_routes

    class _NoWorker:
        @staticmethod
        def count(connection=None, queue=None):  # noqa: ARG004
            return 0

    with (
        patch.object(health_routes, "get_conn", _fake_conn),
        patch.object(health_routes, "get_cursor", _fake_cursor),
        patch.object(health_routes, "object_store_reachable", return_value="ok"),
        patch.object(health_routes, "redis_conn") as mr,
        patch.object(health_routes, "ai_queue", _FakeQueue()),
        patch.object(health_routes, "media_queue", _FakeMediaQueueBusy()),
        patch.object(health_routes, "RqWorker", _NoWorker),
        patch.object(orch_settings, "embed_rq_media_worker", False),
    ):
        mr.ping.return_value = True
        r = TestClient(app).get("/health")
    data = r.json()
    assert data.get("rq_workers") == {"media": 0, "ai": 0}
    assert "queue_alerts" in data
    assert any("media" in a for a in data["queue_alerts"])

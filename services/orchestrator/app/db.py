import atexit
import contextlib
import logging
import os
from typing import Iterator

import psycopg2
from psycopg2 import pool as pg_pool
from psycopg2.extras import RealDictCursor

from .config import settings

logger = logging.getLogger(__name__)


def _log_pg_operational_failure(exc: psycopg2.OperationalError) -> None:
    """Log actionable context without echoing credentials."""
    logger.error(
        "PostgreSQL connection failed: %s. Ensure DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD in "
        "repo root .env.ai-native match the running server; if the data directory was initialized "
        "with another password, ALTER USER ... PASSWORD must match DB_PASSWORD (see DEPLOYMENT.md).",
        exc,
    )

_pool: pg_pool.ThreadedConnectionPool | None = None


def _dsn() -> str:
    connect_timeout_sec = max(1, int(os.getenv("DB_CONNECT_TIMEOUT_SEC", "5")))
    statement_timeout_ms = max(1000, int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "15000")))
    lock_timeout_ms = max(500, int(os.getenv("DB_LOCK_TIMEOUT_MS", "5000")))
    idle_tx_timeout_ms = max(1000, int(os.getenv("DB_IDLE_IN_TX_TIMEOUT_MS", "15000")))
    options = (
        f"-c statement_timeout={statement_timeout_ms} "
        f"-c lock_timeout={lock_timeout_ms} "
        f"-c idle_in_transaction_session_timeout={idle_tx_timeout_ms}"
    )
    return (
        f"host={settings.db_host} port={settings.db_port} dbname={settings.db_name} "
        f"user={settings.db_user} password={settings.db_password} "
        f"connect_timeout={connect_timeout_sec} options='{options}'"
    )


def _use_pool() -> bool:
    raw = (os.getenv("DB_USE_CONNECTION_POOL") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off", "")


def _get_pool() -> pg_pool.ThreadedConnectionPool:
    global _pool
    if _pool is not None:
        return _pool
    minconn = max(1, int(os.getenv("DB_POOL_MIN", "1")))
    maxconn = max(minconn, int(os.getenv("DB_POOL_MAX", "20")))
    try:
        _pool = pg_pool.ThreadedConnectionPool(minconn, maxconn, _dsn())
    except psycopg2.OperationalError as exc:
        _log_pg_operational_failure(exc)
        raise
    atexit.register(_close_pool_quietly)
    logger.info("PostgreSQL connection pool ready (min=%s max=%s)", minconn, maxconn)
    return _pool


def _close_pool_quietly() -> None:
    global _pool
    if _pool is None:
        return
    try:
        _pool.closeall()
    except Exception:
        pass
    _pool = None


@contextlib.contextmanager
def get_conn() -> Iterator[psycopg2.extensions.connection]:
    if not _use_pool():
        try:
            conn = psycopg2.connect(_dsn())
        except psycopg2.OperationalError as exc:
            _log_pg_operational_failure(exc)
            raise
        try:
            yield conn
        finally:
            conn.close()
        return

    p = _get_pool()
    conn = p.getconn()
    try:
        yield conn
    except BaseException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        p.putconn(conn)


@contextlib.contextmanager
def get_cursor(conn) -> Iterator[RealDictCursor]:
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        yield cur
    finally:
        cur.close()

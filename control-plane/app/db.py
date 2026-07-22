"""Database + Redis lifecycle and shared helpers for the control plane."""
import asyncpg
import redis.asyncio as aioredis

from .config import settings

_pool: asyncpg.Pool | None = None
_redis: aioredis.Redis | None = None


async def connect() -> None:
    global _pool, _redis
    _pool = await asyncpg.create_pool(settings.pg_dsn(), min_size=1, max_size=10)
    _redis = aioredis.Redis(host=settings.redis_host, port=settings.redis_port, decode_responses=True)
    # verify redis
    await _redis.ping()


async def disconnect() -> None:
    global _pool, _redis
    if _pool:
        await _pool.close()
    if _redis:
        await _redis.aclose()


def pool() -> asyncpg.Pool:
    assert _pool is not None, "db pool not initialised"
    return _pool


def redis() -> aioredis.Redis:
    assert _redis is not None, "redis not initialised"
    return _redis


def control_channel() -> str:
    return f"control:{{{settings.tenant_id}}}:events"

from redis import Redis
from rq import Queue

from .config import settings


redis_conn = Redis.from_url(settings.redis_url)
ai_queue = Queue("ai", connection=redis_conn)
media_queue = Queue("media", connection=redis_conn)

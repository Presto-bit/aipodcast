import { getRedisClient } from "../infrastructure/redis/client";

type MemBucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, MemBucket>();

function allowInMemory(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = memoryBuckets.get(key);
  if (!b || now > b.resetAt) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

/**
 * 滑动窗口限流：有 REDIS_URL 时用 INCR+EXPIRE（多副本共享），否则进程内 Map。
 */
export async function allowSlidingWindow(
  key: string,
  limit: number,
  windowSec: number
): Promise<boolean> {
  const redis = getRedisClient();
  if (redis) {
    try {
      const rkey = `bff:rl:${key}`;
      const count = await (redis as { incr: (k: string) => Promise<number> }).incr(rkey);
      if (count === 1) {
        await (redis as { expire: (k: string, sec: number) => Promise<unknown> }).expire(rkey, windowSec);
      }
      return count <= limit;
    } catch {
      /* Redis 不可用时回退内存 */
    }
  }
  return allowInMemory(key, limit, windowSec * 1000);
}

type RedisLike = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<unknown>;
  lpush: (key: string, value: string) => Promise<unknown>;
  ltrim: (key: string, start: number, stop: number) => Promise<unknown>;
  lrange: (key: string, start: number, stop: number) => Promise<string[]>;
};

let redisSingleton: RedisLike | null = null;
let initTried = false;

function redisUrl(): string {
  return String(process.env.REDIS_URL || "").trim();
}

export function redisEnabled(): boolean {
  return redisUrl().length > 0;
}

export function getRedisClient(): RedisLike | null {
  if (redisSingleton) return redisSingleton;
  if (initTried) return null;
  initTried = true;
  const url = redisUrl();
  if (!url) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RedisCtor = require("ioredis");
    const client = new RedisCtor(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: false
    }) as RedisLike;
    redisSingleton = client;
    return redisSingleton;
  } catch {
    return null;
  }
}

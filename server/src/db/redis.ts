/**
 * redis.ts
 *
 * Lightweight wrapper that creates and exports a shared `ioredis` client.
 * The client uses `REDIS_URL` environment variable with a sensible local
 * default for development.
 */

import Redis from 'ioredis';

const {
    REDIS_URL = 'redis://127.0.0.1:6379',
} = process.env;

export const redis = new Redis(REDIS_URL);

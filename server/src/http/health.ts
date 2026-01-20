/**
 * health.ts
 *
 * Simple health endpoint that verifies connectivity to Postgres and Redis and
 * returns an aggregated health summary. Used by external orchestrators and
 * quick diagnostics during development.
 */

import type {FastifyInstance} from 'fastify';
import {prisma} from '../db/prisma.js';
import {redis} from '../db/redis.js';

export async function registerHealthRoutes(app: FastifyInstance) {
    app.get('/api/health', async () => {
        const services = {postgres: false, redis: false};
        try {
            await prisma.$queryRaw`SELECT 1`;
            services.postgres = true;
        } catch {
        }
        try {
            services.redis = (await redis.ping()) === 'PONG';
        } catch {
        }
        const allHealthy = Object.values(services).every(Boolean);
        app.log.debug({allHealthy, services});
        return {ok: allHealthy, healthy: allHealthy, services};
    });
}

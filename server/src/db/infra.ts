/**
 * infra.ts
 *
 * Initializes and tears down infrastructure dependencies used by the server:
 * - verifies connectivity to Postgres via `prisma`
 * - verifies Redis connectivity
 * - installs simple background health pings to keep the connections warm and
 *   log transient failures.
 */

import type {FastifyBaseLogger} from 'fastify';
import {prisma} from './prisma.js';
import {redis} from './redis.js';
import {waitUntil} from './waituntil.js';

export async function initInfra(log: FastifyBaseLogger) {
    // Surface Redis runtime errors via the Fastify logger
    redis.on('error', (e: unknown) => {
        log.error({e}, 'redis error');
    });

    // Wait until Postgres responds to a simple SELECT 1
    await waitUntil(() => prisma.$queryRaw`SELECT 1`, 'postgres', log);
    // Wait until Redis responds to PING
    await waitUntil(async () => {
        if ((await redis.ping()) !== 'PONG') throw new Error('redis');
    }, 'redis', log);

    // Background periodic health check to log if Postgres becomes unreachable
    setInterval(async () => {
        try {
            await prisma.$queryRaw`SELECT 1`;
        } catch (e) {
            log.error({e}, 'postgres became unreachable');
        }
    }, 60_000).unref();
}

export async function closeInfra(log: FastifyBaseLogger) {
    log.info('closing infra…');
    await redis.quit().catch((e) => log.error({e}, 'redis quit failed'));
    await prisma.$disconnect().catch((e) => log.error({e}, 'prisma disconnect failed'));
}

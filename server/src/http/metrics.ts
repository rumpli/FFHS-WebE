/**
 * metrics.ts
 *
 * Prometheus metrics endpoint registration. Returns the current scrape output
 * and sets the appropriate content type from the metrics register helper.
 */

import type {FastifyInstance} from 'fastify';
import {register} from '../observability/metrics.js';

export async function registerMetricsRoute(app: FastifyInstance) {
    app.get('/metrics', async (_req, reply) => {
        try {
            reply.type(register.contentType);
            return await register.metrics();
        } catch (err) {
            reply.code(500).send('metrics error');
        }
    });
}

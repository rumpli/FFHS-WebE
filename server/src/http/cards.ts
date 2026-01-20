/**
 * cards.ts
 *
 * Public API route that returns the canonical set of `CardDefinition`s used by
 * the client. Sorted by name to produce stable output for tests and UI.
 */

import type {FastifyInstance} from "fastify";
import {prisma} from "../db/prisma.js";

export async function registerCardRoutes(app: FastifyInstance) {
    app.get("/api/cards", async (_req, reply) => {
        const cards = await prisma.cardDefinition.findMany({
            orderBy: {name: "asc"},
        });
        app.log.info(`Fetched ${cards.length} card definitions`);
        return reply.send({ok: true, cards});
    });
}
/**
 * decks.ts
 *
 * Route returning available decks (seeded or created) transformed into the
 * shared client `SharedDeck` shape. Lightweight mapping keeps API stable.
 */

import type {FastifyInstance} from "fastify";
import {prisma} from "../db/prisma.js";
import type {SharedDeck, SharedDeckCard} from "../../../shared/types/deck";

export async function registerDeckRoutes(app: FastifyInstance) {
    app.get("/api/decks", async (_req, reply) => {
        const dbDecks = await prisma.deck.findMany({
            include: {
                cards: {
                    include: {card: true},
                    orderBy: {slotIndex: "asc"},
                },
            },
            orderBy: {createdAt: "asc"},
        });

        const decks: SharedDeck[] = dbDecks.map((d) => ({
            id: d.id,
            name: d.name,
            cards: d.cards.map((dc): SharedDeckCard => ({
                id: dc.cardId,
                name: dc.card.name,
                type: dc.card.type,
                level: 1,
                copies: dc.copies,
            })),
        }));
        return reply.send({ok: true, decks});
    });
}

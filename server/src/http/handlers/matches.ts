/**
 * matches.ts
 *
 * HTTP handlers for match-related APIs. Exposes endpoints to:
 * - fetch a single match result or built result (`/api/matches/:matchId`)
 * - list matches with optional filtering (`/api/matches`)
 * - list a player's matches (`/api/players/:playerId/matches`)
 * - administrative actions to finalize/persist results and cancel/delete matches
 * - administrative connection controls for debugging (disconnect a websocket)
 *
 * Notes:
 * - Several admin endpoints are gated by environment variables (e.g. `ALLOW_PERSIST`,
 *   `ALLOW_ADMIN`) to prevent accidental use in production.
 * - Responses use small JSON error codes consumed by the client.
 */

import type {FastifyInstance} from 'fastify';
import {prisma} from '../../db/prisma.js';
import {buildMatchResult, persistMatchResult} from '../../match/persistence.js';
import {connections, leaveAllRooms} from '../../ws/registry.js';
import {matchesActiveGauge} from '../../observability/metrics.js';
import {MatchStatus} from '@prisma/client';

export async function registerMatchRoutes(app: FastifyInstance) {
    // GET /api/matches/:matchId — return stored result or build on-demand
    app.get('/api/matches/:matchId', async (req, reply) => {
        const matchId = String((req.params as any).matchId);
        const includeEvents = String((req.query as any).includeEvents ?? 'false') === 'true';
        const match = await prisma.match.findUnique({where: {id: matchId}, include: {rounds: true}});
        if (!match) return reply.code(404).send({ok: false, error: 'NOT_FOUND'});
        // If a canonical result exists and the client didn't ask for events, return it
        if ((match as any).result && !includeEvents) {
            return reply.code(200).send({ok: true, result: (match as any).result});
        }
        // Otherwise build the result (may include events depending on query)
        const built = await buildMatchResult(matchId);
        if (!built) return reply.code(404).send({ok: false, error: 'NOT_FOUND'});
        if (!includeEvents) {
            built.rounds = built.rounds.map(r => ({...r, events: undefined}));
        }
        return reply.code(200).send({ok: true, result: built});
    });

    // GET /api/matches — list matches with optional status filter and limit
    app.get('/api/matches', async (req, reply) => {
        const q = req.query as any;
        const limit = Math.min(Number(q.limit ?? 20), 100);
        const status = q.status as string | undefined;
        const where: any = {};
        if (status) where.status = status;
        const matches = await prisma.match.findMany({where, orderBy: {createdAt: 'desc'}, take: limit});
        return reply.code(200).send({ok: true, matches});
    });

    // GET /api/players/:playerId/matches — player's match history (paginated)
    app.get('/api/players/:playerId/matches', async (req, reply) => {
        const playerId = String((req.params as any).playerId);
        const limit = Math.min(Number((req.query as any).limit ?? 20), 100);
        const rows = await prisma.matchPlayer.findMany({
            where: {userId: playerId},
            include: {match: {select: {id: true, createdAt: true, finishedAt: true, result: true, status: true}}},
            orderBy: {id: 'desc'},
            take: limit
        });
        const res = rows.map(r => ({
            matchId: r.matchId,
            match: r.match ? {
                id: (r.match as any).id,
                createdAt: (r.match as any).createdAt,
                finishedAt: (r.match as any).finishedAt,
                result: (r.match as any).result,
                status: (r.match as any).status
            } : null,
            stats: (r as any).stats
        }));
        return reply.code(200).send({ok: true, matches: res});
    });

    // POST /api/matches/:matchId/finish — persist an in-progress match (gated)
    app.post('/api/matches/:matchId/finish', async (req, reply) => {
        const matchId = String((req.params as any).matchId);
        if (process.env.NODE_ENV !== 'test' && process.env.ALLOW_PERSIST !== '1') {
            return reply.code(403).send({ok: false, error: 'NOT_ALLOWED'});
        }
        try {
            await persistMatchResult(matchId);
            const m = await prisma.match.findUnique({where: {id: matchId}});
            return reply.code(200).send({ok: true, match: m});
        } catch (err) {
            return reply.code(500).send({ok: false, error: 'INTERNAL_ERROR'});
        }
    });

    // POST /api/admin/matches/:matchId/cancel — admin cancel/delete match (gated)
    app.post('/api/admin/matches/:matchId/cancel', async (req, reply) => {
        const matchId = String((req.params as any).matchId);
        if (process.env.NODE_ENV !== 'test' && process.env.ALLOW_ADMIN !== '1') {
            return reply.code(403).send({ok: false, error: 'NOT_ALLOWED'});
        }
        const {action} = req.body as any || {};
        try {
            if (action === 'delete') {
                const m = await prisma.match.findUnique({where: {id: matchId}});
                try {
                    await prisma.matchPlayer.deleteMany({where: {matchId}});
                } catch (e) {
                }
                try {
                    await prisma.match.delete({where: {id: matchId}});
                } catch (e) {
                }
                try {
                    if (m && m.status === MatchStatus.RUNNING) {
                        try {
                            matchesActiveGauge.dec();
                        } catch (e) {
                        }
                    }
                } catch (e) {
                }
                return reply.code(200).send({ok: true, action: 'deleted'});
            } else {
                const prev = await prisma.match.findUnique({where: {id: matchId}});
                await prisma.match.update({where: {id: matchId}, data: {status: 'CANCELLED'}});
                try {
                    if (prev && prev.status === MatchStatus.RUNNING) {
                        try {
                            matchesActiveGauge.dec();
                        } catch (e) {
                        }
                    }
                } catch (e) {
                }
                return reply.code(200).send({ok: true, action: 'cancelled'});
            }
        } catch (err) {
            return reply.code(500).send({ok: false, error: 'INTERNAL_ERROR', details: (err as any)?.message});
        }
    });

    // POST /api/admin/connections/:connId/disconnect — admin helper to disconnect a websocket connection
    app.post('/api/admin/connections/:connId/disconnect', async (req, reply) => {
        const connId = String((req.params as any).connId);
        if (process.env.NODE_ENV !== 'test' && process.env.ALLOW_ADMIN !== '1') {
            return reply.code(403).send({ok: false, error: 'NOT_ALLOWED'});
        }
        try {
            const ctx = connections.get(connId);
            if (!ctx) return reply.code(404).send({ok: false, error: 'NOT_FOUND'});
            try {
                leaveAllRooms(connId);
            } catch (e) {
            }
            try {
                ctx.ws.close();
            } catch (e) {
            }
            try {
                connections.delete(connId);
            } catch (e) {
            }
            return reply.code(200).send({ok: true, connId});
        } catch (err) {
            return reply.code(500).send({ok: false, error: 'INTERNAL_ERROR'});
        }
    });
}

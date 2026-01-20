/**
 * lobbies.ts
 *
 * HTTP routes for lobby creation, listing, joining/leaving and starting a
 * match. Routes authenticate using bearer tokens and map known error
 * conditions to clear JSON responses for the frontend to consume.
 */

import type {FastifyInstance} from 'fastify';
import {prisma} from '../db/prisma.js';
import {verifyAccessToken} from '../auth/jwt.js';
import {broadcastRoom} from '../ws/registry.js';
import {lobbiesOpenGauge, matchesActiveGauge, deckUsageCounter} from '../observability/metrics.js';
import {trace} from '@opentelemetry/api';
import {
    defaultPlayerState,
    shuffleArray,
    savePlayerStateJson,
    drawCards,
    MATCH_CONFIG,
    baseGoldForRound,
    roundDurationMsForRound,
    randomShopWeighted
} from '../ws/matchState.js';
import {scheduleRoundTimeout, broadcastMatchState} from '../ws/index.js';
import {info, debug} from "../logging.js";

export async function registerLobbyRoutes(app: FastifyInstance) {
    app.post('/api/lobbies', async (req, reply) => {
        const token = String((req.headers as any).authorization ?? '').replace(/^Bearer\s+/i, '');
        info('[lobbies] incoming create token:', token);
        if (!token) return reply.code(401).send({ok: false, error: 'AUTH_REQUIRED'});
        let userId: string;
        try {
            const payload = verifyAccessToken(token);
            debug('[lobbies] verifyAccessToken payload:', payload);
            userId = payload.sub;
        } catch (e: any) {
            info('[lobbies] verify failed', e?.message ?? e);
            return reply.code(401).send({ok: false, error: 'AUTH_REQUIRED'});
        }

        const body = req.body as any || {};
        const maxPlayers = Math.max(2, Math.min(Number(body.maxPlayers ?? 2), 8));
        let code = body.code ? String(body.code).trim() : null;
        try {
            if (code) {

                const exists = await prisma.lobby.findUnique({where: {code}});
                if (exists) return reply.code(409).send({ok: false, error: 'CODE_TAKEN'});
            } else {

                code = null;
            }
        } catch (err) {
            return reply.code(500).send({ok: false, error: 'INTERNAL_ERROR'});
        }

        try {
            const lobby = await prisma.lobby.create({
                data: {
                    ownerId: userId,
                    maxPlayers,
                    code,
                    status: 'OPEN',
                },
            });

            await prisma.lobbyPlayer.create({data: {lobbyId: lobby.id, userId}});
            try {
                lobbiesOpenGauge.inc();
            } catch (e) {
            }
            const updated = await prisma.lobby.findUnique({
                where: {id: lobby.id},
                include: {
                    players: {include: {user: {select: {id: true, username: true}}}},
                    owner: {select: {id: true, username: true}}
                }
            });
            try {
                broadcastRoom(`lobby:${lobby.id}`, {type: 'LOBBY_STATE', lobby: updated});
            } catch (e) {
            }
            return reply.code(201).send({ok: true, lobby: updated});
        } catch (err) {
            return reply.code(500).send({ok: false, error: 'INTERNAL_ERROR'});
        }
    });

    app.get('/api/lobbies', async (req, reply) => {
        try {
            const lobbies = await prisma.lobby.findMany({
                where: {status: 'OPEN'},
                include: {owner: {select: {id: true, username: true}}, players: true},
                orderBy: {createdAt: 'desc' as any},
                take: 50,
            });
            const out = lobbies.map((l: any) => ({
                id: l.id,
                codeProtected: !!l.code,
                code: undefined,
                owner: l.owner ? {id: l.owner.id, username: l.owner.username} : null,
                playerCount: Array.isArray(l.players) ? l.players.length : 0,
                maxPlayers: l.maxPlayers,
            }));
            return reply.code(200).send({ok: true, lobbies: out});
        } catch (err) {
            return reply.code(500).send({ok: false, error: 'INTERNAL_ERROR'});
        }
    });

    app.get('/api/lobbies/:id', async (req, reply) => {
        const idOrCode = String((req.params as any).id);
        let lobby = await prisma.lobby.findUnique({
            where: {id: idOrCode},
            include: {
                players: {include: {user: {select: {id: true, username: true}}}},
                owner: {select: {id: true, username: true}}
            }
        });
        if (!lobby) {
            lobby = await prisma.lobby.findUnique({
                where: {code: idOrCode},
                include: {
                    players: {include: {user: {select: {id: true, username: true}}}},
                    owner: {select: {id: true, username: true}}
                }
            });
        }
        if (!lobby) return reply.code(404).send({ok: false, error: 'NOT_FOUND'});
        return reply.code(200).send({ok: true, lobby});
    });

    app.post('/api/lobbies/:id/join', async (req, reply) => {
        const token = String((req.headers as any).authorization ?? '').replace(/^Bearer\s+/i, '');
        if (!token) return reply.code(401).send({ok: false, error: 'AUTH_REQUIRED'});
        let userId: string;
        try {
            const payload = verifyAccessToken(token);
            userId = payload.sub;
        } catch {
            return reply.code(401).send({ok: false, error: 'AUTH_REQUIRED'});
        }

        const idOrCode = String((req.params as any).id);
        const body = req.body as any || {};
        const code = body.code ? String(body.code) : null;
        let lobby = await prisma.lobby.findUnique({where: {id: idOrCode}, include: {players: true}});
        let lookedUpByCode = false;
        if (!lobby) {
            lobby = await prisma.lobby.findUnique({where: {code: idOrCode}, include: {players: true}});
            lookedUpByCode = !!lobby;
        }
        if (!lobby) return reply.code(404).send({ok: false, error: 'NOT_FOUND'});
        if (lobby.status !== 'OPEN') return reply.code(409).send({ok: false, error: 'NOT_OPEN'});
        if (!lookedUpByCode && lobby.code && lobby.code !== code) return reply.code(403).send({
            ok: false,
            error: 'BAD_CODE'
        });
        if (lobby.players.length >= lobby.maxPlayers) return reply.code(409).send({ok: false, error: 'FULL'});
        try {
            const exists = await prisma.lobbyPlayer.findFirst({where: {lobbyId: lobby.id, userId}});
            if (exists) return reply.code(200).send({ok: true, lobby});
            await prisma.lobbyPlayer.create({data: {lobbyId: lobby.id, userId}});
            const updated2 = await prisma.lobby.findUnique({
                where: {id: lobby.id},
                include: {
                    players: {include: {user: {select: {id: true, username: true}}}},
                    owner: {select: {id: true, username: true}}
                }
            });
            try {
                broadcastRoom(`lobby:${lobby.id}`, {type: 'LOBBY_STATE', lobby: updated2});
            } catch (e) {
            }
            return reply.code(200).send({ok: true, lobby: updated2});
        } catch (err) {
            return reply.code(500).send({ok: false, error: 'INTERNAL_ERROR'});
        }
    });

    app.post('/api/lobbies/:id/leave', async (req, reply) => {
        const token = String((req.headers as any).authorization ?? '').replace(/^Bearer\s+/i, '');
        if (!token) return reply.code(401).send({ok: false, error: 'AUTH_REQUIRED'});
        let userId: string;
        try {
            const payload = verifyAccessToken(token);
            userId = payload.sub;
        } catch {
            return reply.code(401).send({ok: false, error: 'AUTH_REQUIRED'});
        }
        const id = String((req.params as any).id);
        try {
            await prisma.lobbyPlayer.deleteMany({where: {lobbyId: id, userId}});
            const remaining = await prisma.lobbyPlayer.count({where: {lobbyId: id}});
            if (remaining === 0) {
                await prisma.lobby.delete({where: {id}});
                try {
                    lobbiesOpenGauge.dec();
                } catch (e) {
                }
                try {
                    broadcastRoom(`lobby:${id}`, {type: 'LOBBY_STATE', lobby: null});
                } catch (e) {
                }
            } else {
                const lobby = await prisma.lobby.findUnique({where: {id}, include: {owner: true}});
                if (lobby && lobby.ownerId === userId) {
                    const next = await prisma.lobbyPlayer.findFirst({where: {lobbyId: id}, orderBy: {joinedAt: 'asc'}});
                    if (next) await prisma.lobby.update({where: {id}, data: {ownerId: next.userId}});
                }
                const updated3 = await prisma.lobby.findUnique({
                    where: {id},
                    include: {
                        players: {include: {user: {select: {id: true, username: true}}}},
                        owner: {select: {id: true, username: true}}
                    }
                });
                try {
                    broadcastRoom(`lobby:${id}`, {type: 'LOBBY_STATE', lobby: updated3});
                } catch (e) {
                }
            }
            return reply.code(200).send({ok: true});
        } catch (err) {
            return reply.code(500).send({ok: false, error: 'INTERNAL_ERROR'});
        }
    });

    app.post('/api/lobbies/:id/close', async (req, reply) => {
        const token = String((req.headers as any).authorization ?? '').replace(/^Bearer\s+/i, '');
        if (!token) return reply.code(401).send({ok: false, error: 'AUTH_REQUIRED'});
        let userId: string;
        try {
            const payload = verifyAccessToken(token);
            userId = payload.sub;
        } catch {
            return reply.code(401).send({ok: false, error: 'AUTH_REQUIRED'});
        }
        const id = String((req.params as any).id);
        try {
            const lobby = await prisma.lobby.findUnique({where: {id}});
            if (!lobby) return reply.code(404).send({ok: false, error: 'NOT_FOUND'});
            if (lobby.ownerId !== userId) return reply.code(403).send({ok: false, error: 'NOT_OWNER'});
            await prisma.lobby.delete({where: {id}});
            try {
                lobbiesOpenGauge.dec();
            } catch (e) {
            }
            try {
                broadcastRoom(`lobby:${id}`, {type: 'LOBBY_STATE', lobby: null});
            } catch (e) {
            }
            return reply.code(200).send({ok: true});
        } catch (err) {
            return reply.code(500).send({ok: false, error: 'INTERNAL_ERROR'});
        }
    });

    app.post('/api/lobbies/:id/start', async (req, reply) => {
        const token = String((req.headers as any).authorization ?? '').replace(/^Bearer\s+/i, '');
        if (!token) return reply.code(401).send({ok: false, error: 'AUTH_REQUIRED'});
        let userId: string;
        try {
            const payload = verifyAccessToken(token);
            userId = payload.sub;
        } catch {
            return reply.code(401).send({ok: false, error: 'AUTH_REQUIRED'});
        }

        const id = String((req.params as any).id);
        const lobby = await prisma.lobby.findUnique({where: {id}, include: {players: true}});
        if (!lobby) return reply.code(404).send({ok: false, error: 'NOT_FOUND'});
        if (lobby.ownerId !== userId) return reply.code(403).send({ok: false, error: 'NOT_OWNER'});
        if (lobby.players.length < 2) return reply.code(409).send({ok: false, error: 'NOT_ENOUGH_PLAYERS'});
        try {
            const allReady = Array.isArray(lobby.players) && lobby.players.length > 0 && lobby.players.every((p: any) => !!p.isReady);
            if (!allReady) return reply.code(409).send({ok: false, error: 'NOT_ALL_READY'});
        } catch {
        }
        try {
            const now = Date.now();
            const match = await prisma.$transaction(async (tx) => {
                const m = await tx.match.create({data: {status: 'RUNNING'}});
                let seat = 0;
                for (const p of lobby.players) {
                    const deckId = (p as any).deckId ?? null;
                    const deck = await (async () => {
                        if (deckId) {
                            try {
                                const d = await tx.deck.findUnique({
                                    where: {id: deckId},
                                    include: {
                                        cards: {include: {card: true}, orderBy: {slotIndex: 'asc'}},
                                    },
                                });
                                if (d) return d;
                            } catch {
                            }
                        }
                        try {
                            return await tx.deck.findFirst({
                                include: {
                                    cards: {include: {card: true}, orderBy: {slotIndex: 'asc'}},
                                },
                                orderBy: {createdAt: 'asc'},
                            });
                        } catch {
                            return null;
                        }
                    })();
                    const base = defaultPlayerState();
                    const initialState: any = {
                        ...base,
                        deck: deck
                            ? shuffleArray(deck.cards.flatMap((dc: any) => Array(dc.copies).fill(dc.cardId)))
                            : [],
                    };
                    initialState.round = initialState.round ?? 1;
                    initialState.phase = 'shop';
                    initialState.gold = baseGoldForRound(initialState.round);
                    initialState.roundTimerTs = now + roundDurationMsForRound(initialState.round);
                    drawCards(initialState, MATCH_CONFIG.handSizePerRound);
                    if (!initialState.shop || initialState.shop.length === 0) {
                        initialState.shop = await randomShopWeighted(1);
                    }
                    await tx.matchPlayer.create({
                        data: {
                            matchId: m.id,
                            userId: p.userId,
                            seat: seat++,
                            isReady: true,
                            deckId,
                            state: savePlayerStateJson(initialState),
                        },
                    });
                    try {
                        if (p && (p as any).deckId) {
                            try {
                                deckUsageCounter.inc({deck_id: String((p as any).deckId)}, 1);
                            } catch (e) {
                            }
                        }
                    } catch (e) {
                    }
                }
                await tx.lobby.update({where: {id}, data: {status: 'STARTED', matchId: m.id}});
                return m;
            });

            try {
                matchesActiveGauge.inc();
            } catch (e) {
            }
            try {
                lobbiesOpenGauge.dec();
            } catch (e) {
            }
            try {
                await scheduleRoundTimeout(match.id);
            } catch (e) {
            }
            try {
                await broadcastMatchState(match.id);
            } catch (e) {
            }
            try {
                const tracer = trace.getTracer('server');
                const span = tracer.startSpan('match.start', {attributes: {'match.id': match.id}});
                span.end();
            } catch (e) {
            }
            const updated4 = await prisma.lobby.findUnique({
                where: {id},
                include: {
                    players: {include: {user: {select: {id: true, username: true}}}},
                    owner: {select: {id: true, username: true}}
                }
            });
            try {
                broadcastRoom(`lobby:${id}`, {type: 'LOBBY_STATE', lobby: updated4});
            } catch (e) {
            }
            return reply.code(200).send({ok: true, matchId: match.id});
        } catch (err) {
            return reply.code(500).send({ok: false, error: 'INTERNAL_ERROR'});
        }
    });
}

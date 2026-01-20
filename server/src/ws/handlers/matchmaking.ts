/**
 * matchmaking.ts
 *
 * WebSocket handlers for matchmaking flow: starting matchmaking, cancelling
 * matchmaking, and confirming readiness to start a match. These handlers
 * manipulate `match` and `matchPlayer` rows and broadcast match/lobby state
 * updates.
 */

import type {WebSocket} from "ws";
import {MatchPlayer, MatchStatus} from "@prisma/client";
import type {ClientMsg} from "../protocol.js";
import {prisma} from "../../db/prisma.js";
import {broadcastRoom, joinRoom, send} from "../registry.js";
import {
    baseGoldForRound,
    defaultPlayerState,
    drawCards,
    MATCH_CONFIG,
    randomShopWeighted,
    readPlayerState,
    roundDurationMsForRound,
    savePlayerStateJson,
    shuffleArray,
} from "../matchState.js";
import {broadcastMatchState, scheduleRoundTimeout} from "../index.js";

const matchRoom = (matchId: string) => `match:${matchId}`;

export async function handleMatchmakingStart(
    ws: WebSocket,
    connId: string,
    msg: Extract<ClientMsg, { type: "MATCHMAKING_START" }>,
    userId: string,
): Promise<void> {
    const user = await prisma.user.findUnique({where: {id: userId}});
    if (!user) {
        send(ws, {type: "ERROR", code: "USER_NOT_FOUND", message: "Authenticated user not found in database"});
        return;
    }
    const existing = await prisma.matchPlayer.findFirst({
        where: {
            userId,
            match: {
                status: {
                    in: [
                        MatchStatus.QUEUE,
                        MatchStatus.LOBBY,
                        MatchStatus.RUNNING,
                    ],
                },
            },
        },
        include: {match: true},
    });

    if (existing) {
        if (existing.match.status === MatchStatus.RUNNING) {
            send(ws, {
                type: "MATCH_READY",
                matchId: existing.matchId,
            });
        } else {
            send(ws, {
                type: "MATCH_WAITING",
                matchId: existing.matchId,
            });
        }
        return;
    }

    const result = await prisma.$transaction(async (tx) => {
        let queueMatch = await tx.match.findFirst({
            where: {status: MatchStatus.QUEUE},
            orderBy: {createdAt: "asc"},
            include: {
                _count: {select: {players: true}},
            },
        });

        if (!queueMatch || queueMatch._count.players >= 2) {
            queueMatch = await tx.match.create({
                data: {status: MatchStatus.QUEUE},
                include: {
                    _count: {select: {players: true}},
                },
            });
        }

        const deck = await (async () => {
            if (msg.deckId) {
                const d = await tx.deck.findUnique({
                    where: {id: msg.deckId},
                    include: {
                        cards: {include: {card: true}, orderBy: {slotIndex: "asc"}},
                    },
                });
                if (d) return d;
            }
            return tx.deck.findFirst({
                include: {
                    cards: {include: {card: true}, orderBy: {slotIndex: "asc"}},
                },
                orderBy: {createdAt: "asc"},
            });
        })();

        const base = defaultPlayerState();
        const initialState = {
            ...base,
            deck: deck
                ? shuffleArray(deck.cards.flatMap((dc) => Array(dc.copies).fill(dc.cardId)))
                : [],
        };

        const seat = await tx.matchPlayer.count({
            where: {matchId: queueMatch.id},
        });

        await tx.matchPlayer.create({
            data: {
                matchId: queueMatch.id,
                userId,
                seat,
                isReady: false,
                deckId: deck?.id ?? null,
                state: savePlayerStateJson(initialState),
            },
        });

        const playerCount = await tx.matchPlayer.count({
            where: {matchId: queueMatch.id},
        });

        if (playerCount >= 2 && queueMatch.status !== MatchStatus.LOBBY) {
            await tx.match.update({
                where: {id: queueMatch.id},
                data: {status: MatchStatus.LOBBY},
            });
        }
        return {
            matchId: queueMatch.id,
            playerCount,
        };
    });

    send(ws, {
        type: "MATCH_WAITING",
        matchId: result.matchId,
    });

    joinRoom(connId, matchRoom(result.matchId));

    if (result.playerCount >= 2) {
        broadcastRoom(matchRoom(result.matchId), {
            type: "MATCH_LOBBY",
            matchId: result.matchId,
        });
    } else {
        broadcastRoom(matchRoom(result.matchId), {
            type: "MATCH_WAITING",
            matchId: result.matchId,
        });
    }
}

export async function handleMatchmakingCancel(
    ws: WebSocket,
    _connId: string,
    _msg: Extract<ClientMsg, { type: "MATCHMAKING_CANCEL" }>,
    userId: string,
): Promise<void> {
    await prisma.$transaction(async (tx) => {
        const lobbyPlayers = await tx.matchPlayer.findMany({
            where: {
                userId,
                match: {
                    status: {
                        in: [MatchStatus.QUEUE, MatchStatus.LOBBY],
                    },
                },
            },
            select: {matchId: true},
        });

        if (lobbyPlayers.length === 0) return;
        const matchIds = [...new Set(lobbyPlayers.map((p) => p.matchId))];
        await tx.matchPlayer.deleteMany({
            where: {
                userId,
                matchId: {in: matchIds},
            },
        });

        for (const matchId of matchIds) {
            const remaining = await tx.matchPlayer.count({
                where: {matchId},
            });
            if (remaining === 0) {
                await tx.match.delete({where: {id: matchId}});
            }
        }
    });
    send(ws, {type: "MATCHMAKING_CANCELLED"});
}

export async function handleMatchReadyConfirm(
    ws: WebSocket,
    _connId: string,
    msg: Extract<ClientMsg, { type: "MATCH_READY_CONFIRM" }>,
    userId: string,
): Promise<void> {
    const match = await prisma.match.findFirst({
        where: {
            id: msg.matchId,
            status: MatchStatus.LOBBY,
            players: {some: {userId}},
        },
        include: {players: true},
    });

    if (!match) {
        send(ws, {
            type: "ERROR",
            code: "MATCH_NOT_FOUND",
        });
        return;
    }

    await prisma.matchPlayer.updateMany({
        where: {matchId: match.id, userId},
        data: {isReady: true},
    });

    const updatedPlayers = await prisma.matchPlayer.findMany({
        where: {matchId: match.id},
    });

    const allReady =
        updatedPlayers.length > 0 &&
        updatedPlayers.every((p) => p.isReady);

    if (allReady) {
        await prisma.$transaction(async (tx) => {
            await tx.match.update({
                where: {id: match.id},
                data: {status: MatchStatus.RUNNING},
            });
            const players = await tx.matchPlayer.findMany({
                where: {matchId: match.id},
            });
            const now = Date.now();
            for (const mp of players) {
                const state = readPlayerState(mp as MatchPlayer);
                state.round = state.round ?? 1;
                state.phase = "shop";
                const round = state.round;
                state.gold = baseGoldForRound(round);
                state.roundTimerTs = now + roundDurationMsForRound(round);
                drawCards(state, MATCH_CONFIG.handSizePerRound);
                if (!state.shop || state.shop.length === 0) {
                    state.shop = await randomShopWeighted(1);
                }
                await tx.matchPlayer.update({
                    where: {id: mp.id},
                    data: {state: savePlayerStateJson(state)},
                });
            }
        });
        await scheduleRoundTimeout(match.id);
        await broadcastMatchState(match.id);
        broadcastRoom(matchRoom(match.id), {
            type: "MATCH_READY",
            matchId: match.id,
        });
    } else {
        send(ws, {
            type: "MATCH_WAITING",
            matchId: match.id,
        });
    }
}

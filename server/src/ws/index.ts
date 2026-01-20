/**
 * index.ts
 *
 * Central WebSocket entry and runtime utilities.
 * Responsibilities:
 * - Register the `/ws` websocket endpoint and dispatch incoming messages to
 *   specific handlers.
 * - Manage per-match round timers (scheduling, clearing, and auto-ending rounds).
 * - Provide helper plumbing for broadcasting match state and coordinating
 *   client acks for battle playback.
 *
 * Notes:
 * - The module keeps some in-memory maps (`roundTimers`, `scheduleLocks`,
 *   `battleAck*`) to coordinate timing and deduping. These are intentional
 *   runtime constructs and not persisted.
 */

import type {FastifyInstance} from "fastify";
import type {RawData} from "ws";
import {ClientMsg} from "./protocol.js";
import {connections, leaveAllRooms, send, broadcastRoom, roomPeers} from "./registry.js";
import {verifyAccessToken} from "../auth/jwt.js";
import {prisma} from "../db/prisma.js";
import {MatchStatus} from "@prisma/client";
import {readPlayerState, roundDurationMsForRound} from "./matchState.js";
import {
    handleMatchmakingStart,
    handleMatchmakingCancel,
    handleMatchReadyConfirm,
} from "./handlers/matchmaking.js";
import {handleMatchEndRound} from "./handlers/round.js";
import {handleChatSend, handleMatchJoin} from "./handlers/chat.js";
import {handleBoardPlace, handleBoardSell, handleTowerUpgrade} from "./handlers/board.js";
import {broadcastMatchState as broadcastMatchStateSnapshots} from "./matchBroadcast.js";
import {handleShopBuy, handleShopReroll} from "./handlers/shop.js";
import {getLastBroadcastAt} from "./matchBroadcast.js";
import {debug, info, error, warn} from "../logging.js";
import {matchesActiveGauge} from '../observability/metrics.js';
import {handleLobbySubscribe, handleLobbySetDeck, handleLobbySetReady} from './handlers/lobby.js';

const matchRoom = (matchId: string) => `match:${matchId}`;
const roundTimers = new Map<string, NodeJS.Timeout>();
const roundDeadlines = new Map<string, number>();
const scheduleLocks = new Map<string, Promise<void>>();

function newConnId() {
    return `${Date.now()}-${crypto.randomUUID()}`;
}

export function clearRoundTimer(matchId: string) {
    const t = roundTimers.get(matchId);
    if (t) {
        clearTimeout(t);
        roundTimers.delete(matchId);
    }
    // clear the deadline marker as well
    roundDeadlines.delete(matchId);
}

export async function scheduleRoundTimeout(matchId: string) {
    const prev = scheduleLocks.get(matchId) ?? Promise.resolve();
    let resolveLock: () => void = () => {
    };
    const lockPromise = new Promise<void>((res) => {
        resolveLock = res;
    });
    scheduleLocks.set(matchId, lockPromise);
    try {
        // Wait for any concurrent scheduling attempt to finish
        await prev;
        // If DB not available, skip scheduling (useful for tests)
        if (typeof (prisma as any) === 'undefined' || typeof (prisma as any).match?.findUnique !== 'function') {
            debug('[roundTimer] prisma unavailable - skip scheduling', {matchId});
            return;
        }
        const match = await prisma.match.findUnique({
            where: {id: matchId},
            include: {players: true},
        });
        if (!match) {
            return;
        }

        // Only schedule for running matches
        if (match.status !== MatchStatus.RUNNING) {
            debug('[roundTimer] skip scheduling - match not RUNNING', {matchId, status: match.status});
            return;
        }
        const survivors = match.players.filter((p) => !p.isEliminated);
        if (!survivors.length) return;
        const now = Date.now();
        const states = survivors.map((p) => readPlayerState(p as any));
        const round = states[0]?.round ?? 1;
        const timerValues = states
            .map((s) => (typeof s.roundTimerTs === 'number' ? s.roundTimerTs : null))
            .filter((v) => v !== null) as number[];
        let delayMs: number;
        if (timerValues.length > 0) {
            const maxTs = Math.max(...timerValues);
            delayMs = Math.max(0, maxTs - now);
        } else {
            delayMs = roundDurationMsForRound(round);
        }
        const MIN_DELAY_MS = 50;
        if (delayMs < MIN_DELAY_MS) delayMs = MIN_DELAY_MS;
        const deadline = now + delayMs;
        debug("[roundTimer] schedule", {
            matchId,
            round,
            delayMs,
            now,
            deadline,
        });
        const peers = roomPeers.get(matchRoom(matchId));
        let hasActive = false;
        if (peers && peers.size > 0) {
            hasActive = true;
        } else {
            // If no peers in the room, check global connections for any participant connected
            for (const p of match.players) {
                const found = [...connections.values()].some((c) => c.userId === p.userId && c.ws.readyState === c.ws.OPEN);
                if (found) {
                    hasActive = true;
                    break;
                }
            }
        }
        if (!hasActive) {
            // If there is no active connection, avoid scheduling for long-stale matches
            const STALE_NO_BROADCAST_MS = 60_000;
            const last = getLastBroadcastAt(matchId) ?? 0;
            if (now - last > STALE_NO_BROADCAST_MS) {
                debug('[roundTimer] skip scheduling - no active connections AND match appears stale', {
                    matchId,
                    last,
                    now
                });
                return;
            }
            debug('[roundTimer] scheduling despite no active connections (recent activity)', {matchId, last, now});
        }

        const existingDeadline = roundDeadlines.get(matchId);
        if (typeof existingDeadline === 'number' && existingDeadline === deadline) {
            debug('[roundTimer] skip scheduling - identical deadline already scheduled', {matchId, deadline});
            return;
        }

        // Clear any previous timer and set a new one
        clearRoundTimer(matchId);
        const t = setTimeout(async () => {
            roundDeadlines.delete(matchId);
            roundTimers.delete(matchId);
            try {
                debug('[roundTimer] fired', {matchId, now: Date.now()});
                const survivor = await prisma.matchPlayer.findFirst({
                    where: {matchId, isEliminated: false},
                });
                if (!survivor) return;
                debug('[roundTimer] resolved survivor', {matchId, userId: survivor.userId});
                const entry = [...connections.values()].find((c) => c.userId === survivor.userId);
                const connId = entry?.connId ?? null;
                const ws = entry?.ws ?? null;
                try {
                    // Trigger the end-round flow on behalf of the surviving player
                    await handleMatchEndRound(
                        ws ?? null,
                        connId ?? null,
                        {type: "MATCH_END_ROUND", matchId} as any,
                        survivor.userId,
                        sendMatchState,
                    );
                    debug('[roundTimer] handleMatchEndRound completed', {matchId, userId: survivor.userId});
                    try {
                        await broadcastMatchState(matchId);
                    } catch (err) {
                        error('[roundTimer] broadcastMatchState failed', {matchId, err});
                    }
                    try {
                        await scheduleRoundTimeout(matchId);
                    } catch (err) {
                        error('[roundTimer] scheduleRoundTimeout failed', {matchId, err});
                    }
                } catch (err) {
                    error('[roundTimer] handleMatchEndRound threw', {matchId, err});
                }
            } catch (err) {
                error("[roundTimer] failed to auto-end round", err);
            }
        }, delayMs);
        roundTimers.set(matchId, t);
        roundDeadlines.set(matchId, deadline);
    } finally {
        try {
            resolveLock();
        } catch {
        }
        if (scheduleLocks.get(matchId) === lockPromise) scheduleLocks.delete(matchId);
    }
}

async function sendMatchState(connId: string, matchId: string) {
    const ctx = connections.get(connId);
    if (!ctx?.userId) return;
    const match = await prisma.match.findUnique({where: {id: matchId}});
    if (!match) return;
    if (match.status === MatchStatus.FINISHED || match.status === MatchStatus.CANCELLED) {
        try {
            send(ctx.ws, {type: "ERROR", code: "MATCH_NOT_RUNNING"});
        } catch {
        }
        return;
    }
    const {getSerializedMatchStateSnapshots} = await import("./matchBroadcast.js");
    const snapshots = await getSerializedMatchStateSnapshots(matchId);
    if (!snapshots || !Array.isArray(snapshots)) return;
    const snap = snapshots.find((s) => s.self.userId === ctx.userId);
    if (!snap) return;
    send(ctx.ws, {
        type: "MATCH_STATE",
        v: 1,
        ...snap,
    });
}

export async function broadcastMatchState(matchId: string) {
    await broadcastMatchStateSnapshots(matchId);
}

export async function registerWs(app: FastifyInstance) {
    app.get("/ws", {websocket: true}, (conn) => {
        const ws = conn;
        const connId = newConnId();
        connections.set(connId, {
            connId,
            ws,
            state: "ANON",
            userId: null,
            rooms: new Set(),
            connectedAt: Date.now(),
        });

        send(ws, {type: "HELLO", connId, room: "lobby", ts: Date.now()});

        ws.on("close", () => {
            leaveAllRooms(connId);
            connections.delete(connId);
        });

        ws.on("message", async (buf: RawData) => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(buf.toString());
            } catch {
                return send(ws, {type: "ERROR", code: "BAD_JSON"});
            }
            const res = ClientMsg.safeParse(parsed);
            if (!res.success) {
                return send(ws, {
                    type: "ERROR",
                    code: "BAD_MSG",
                    issues: res.error.issues,
                });
            }
            const msg = res.data;
            const ctx = connections.get(connId);
            if (!ctx) return;
            try {
                switch (msg.type) {
                    case "PING":
                        send(ws, {type: "PONG"});
                        break;
                    case 'LOBBY_SUBSCRIBE':
                        await handleLobbySubscribe(ws, connId, msg as any, ctx.userId ?? null);
                        return;
                    case 'LOBBY_SET_DECK':
                        await handleLobbySetDeck(ws, connId, msg as any, ctx.userId ?? null);
                        return;
                    case 'LOBBY_SET_READY':
                        await handleLobbySetReady(ws, connId, msg as any, ctx.userId ?? null);
                        return;
                    case "AUTH":
                        try {
                            const payload = verifyAccessToken(msg.token);
                            ctx.userId = payload.sub;
                            ctx.state = "AUTH";
                            return send(ws, {
                                type: "AUTH_OK",
                                userId: ctx.userId,
                            });
                        } catch {
                            return send(ws, {type: "AUTH_FAIL"});
                        }
                    case "MATCH_STATE_REQUEST":
                        if (!msg.matchId) {
                            return send(ws, {type: "ERROR", code: "MATCH_ID_REQUIRED"});
                        }
                        await sendMatchState(connId, msg.matchId);
                        return;
                    case "MATCHMAKING_START":
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        await handleMatchmakingStart(ws, connId, msg, ctx.userId);
                        return;
                    case "MATCHMAKING_CANCEL":
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        await handleMatchmakingCancel(ws, connId, msg, ctx.userId);
                        return;
                    case "MATCH_READY_CONFIRM":
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        await handleMatchReadyConfirm(ws, connId, msg, ctx.userId);
                        return;
                    case "MATCH_END_ROUND":
                        if (process.env.ALLOW_CLIENT_END_ROUND !== '1') {
                            warn('[ws] client MATCH_END_ROUND rejected (disabled) for', ctx.userId, msg.matchId);
                            return send(ws, {type: "ERROR", code: "NOT_ALLOWED"});
                        }
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        debug("[ws] MATCH_END_ROUND received (client)", {
                            matchId: msg.matchId,
                            connId,
                            userId: ctx.userId,
                        });
                        clearRoundTimer(msg.matchId);
                        await handleMatchEndRound(ws, connId, msg, ctx.userId, sendMatchState);
                        try {
                            await scheduleRoundTimeout(msg.matchId);
                        } catch (err) {
                            try {
                                error('[ws] scheduleRoundTimeout failed after client MATCH_END_ROUND', {
                                    matchId: msg.matchId,
                                    err
                                });
                            } catch {
                            }
                        }
                        return;
                    case "MATCH_FORFEIT":
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        await prisma.matchPlayer.updateMany({
                            where: {matchId: msg.matchId, userId: ctx.userId},
                            data: {isReady: false, isEliminated: true},
                        });
                        broadcastRoom(matchRoom(msg.matchId), {
                            type: "MATCH_FORFEIT_INFO",
                            matchId: msg.matchId,
                            userId: ctx.userId,
                        });
                        const remaining = await prisma.matchPlayer.count({
                            where: {matchId: msg.matchId, isEliminated: false},
                        });
                        if (remaining <= 1) {
                            clearRoundTimer(msg.matchId);
                            const survivor = await prisma.matchPlayer.findFirst({
                                where: {
                                    matchId: msg.matchId,
                                    isEliminated: false
                                }
                            });
                            const winnerUserId = survivor?.userId ?? null;
                            const updateData: any = {status: MatchStatus.FINISHED, finishedAt: new Date()};
                            if (winnerUserId) updateData.winnerId = winnerUserId;
                            await prisma.match.update({
                                where: {id: msg.matchId},
                                data: updateData,
                            });
                            try {
                                await prisma.lobby.updateMany({
                                    where: {matchId: msg.matchId},
                                    data: {status: 'CLOSED', matchId: null},
                                });
                            } catch (e) {
                            }
                            if (winnerUserId) {
                                await prisma.matchPlayer.updateMany({
                                    where: {
                                        matchId: msg.matchId,
                                        userId: winnerUserId
                                    }, data: {finalRank: 1}
                                });
                            }
                            await broadcastMatchState(msg.matchId);
                            try {
                                const {persistMatchResult} = await import('../match/persistence.js');
                                await persistMatchResult(msg.matchId);
                            } catch (err) {
                                try {
                                    error('[ws] persistMatchResult failed for forfeited match', {
                                        matchId: msg.matchId,
                                        err
                                    });
                                } catch {
                                }
                            }
                            return;
                        }
                        await handleMatchEndRound(ws, connId, {
                            ...msg,
                            type: "MATCH_END_ROUND",
                        } as any, ctx.userId, sendMatchState);
                        await broadcastMatchState(msg.matchId);
                        return;
                    case "SHOP_REROLL":
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        await handleShopReroll(ws, connId, msg, ctx.userId, sendMatchState);
                        return;
                    case "SHOP_BUY":
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        await handleShopBuy(ws, connId, msg, ctx.userId, sendMatchState);
                        return;
                    case "BOARD_PLACE":
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        await handleBoardPlace(ws, connId, msg, ctx.userId, sendMatchState);
                        return;
                    case "BOARD_SELL":
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        await handleBoardSell(ws, connId, msg, ctx.userId, sendMatchState);
                        return;
                    case "TOWER_UPGRADE":
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        await handleTowerUpgrade(ws, connId, msg, ctx.userId, sendMatchState);
                        return;
                    case "MATCH_JOIN":
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        await handleMatchJoin(ws, connId, msg, ctx.userId);
                        return;
                    case "CHAT_HISTORY_REQUEST":
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        await (await import('./handlers/chat.js')).handleChatHistoryRequest(ws as any, connId as any, msg as any, ctx.userId);
                        return;
                    case "CHAT_SEND":
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        await handleChatSend(ws, connId, msg, ctx.userId);
                        return;
                    case "BATTLE_DONE":
                        if (!ctx.userId) {
                            return send(ws, {type: "ERROR", code: "AUTH_REQUIRED"});
                        }
                        await (await import('./index.js')).recordBattleDone(msg.matchId, msg.round, ctx.userId);
                        return;
                    default:
                        send(ws, {type: "ERROR", code: "UNKNOWN_TYPE"});
                }
            } catch (err) {
                error("[ws] message handling error", err);
                send(ws, {type: "ERROR", code: "INTERNAL_ERROR"});
            }
        });
    });

    const SWEEP_INTERVAL_MS = 30_000;
    const INACTIVITY_THRESHOLD_MS = 60_000;
    const LOBBY_STALE_MS = Number(process.env.LOBBY_STALE_MS ?? (5 * 60 * 1000));
    const sweeper = setInterval(async () => {
        try {
            const candidates = await prisma.match.findMany({where: {status: {in: [MatchStatus.RUNNING, MatchStatus.LOBBY, MatchStatus.QUEUE]}}});
            const now = Date.now();
            for (const m of candidates) {
                const matchAgeMs = now - new Date((m as any).createdAt ?? now).getTime();
                if ((m.status === MatchStatus.LOBBY || m.status === MatchStatus.QUEUE) && matchAgeMs > LOBBY_STALE_MS) {
                    try {
                        const playerCount = await prisma.matchPlayer.count({where: {matchId: m.id}});
                        if (playerCount <= 1) {
                            info('[sweeper] deleting old LOBBY/QUEUE match with <=1 players (force)', {
                                matchId: m.id,
                                status: m.status,
                                playerCount,
                                matchAgeMs,
                                LOBBY_STALE_MS
                            });
                            try {
                                await prisma.matchPlayer.deleteMany({where: {matchId: m.id}});
                            } catch (e) {
                                try {
                                    error('[sweeper] failed to delete matchPlayers for old match', {
                                        matchId: m.id,
                                        err: e
                                    });
                                } catch {
                                }
                            }
                            try {
                                await prisma.match.delete({where: {id: m.id}});
                            } catch (e) {
                                error('[sweeper] failed to delete stale match', {matchId: m.id, err: e});
                            }
                            continue;
                        }
                    } catch (err) {
                        try {
                            error('[sweeper] failed to evaluate old LOBBY/QUEUE match', {matchId: m.id, err});
                        } catch {
                        }
                    }
                }
                const room = matchRoom(m.id);
                const peers = roomPeers.get(room);
                let hasActive = false;
                if (peers && peers.size > 0) {
                    hasActive = true;
                    if (m.status !== MatchStatus.RUNNING && peers.size === 1) {
                        try {
                            const [singleConnId] = Array.from(peers);
                            const ctx = connections.get(singleConnId);
                            const connectedAt = ctx?.connectedAt ?? 0;
                            if (now - connectedAt > INACTIVITY_THRESHOLD_MS) {
                                debug('[sweeper] single peer stale for non-RUNNING match - cancelling', {
                                    matchId: m.id,
                                    connId: singleConnId,
                                    connectedAt
                                });
                                hasActive = false;
                            }
                        } catch (err) {
                            try {
                                error('[sweeper] failed to inspect single peer for staleness', {matchId: m.id, err});
                            } catch {
                            }
                        }
                    }
                } else {
                    const players = await prisma.matchPlayer.findMany({where: {matchId: m.id}});
                    for (const p of players) {
                        const found = [...connections.values()].some((c) => c.userId === p.userId && c.ws.readyState === c.ws.OPEN);
                        if (found) {
                            hasActive = true;
                            break;
                        }
                    }
                }
                if (!hasActive) {
                    const last = getLastBroadcastAt(m.id) ?? 0;
                    if (now - last > INACTIVITY_THRESHOLD_MS) {
                        try {
                            if (m.status === MatchStatus.RUNNING) {
                                info('[sweeper] marking stale RUNNING match as CANCELLED', {matchId: m.id});
                                clearRoundTimer(m.id);
                                await prisma.match.update({where: {id: m.id}, data: {status: MatchStatus.CANCELLED}});
                                try {
                                    matchesActiveGauge.dec();
                                } catch (e) {
                                }
                            } else {
                                const playerCount = await prisma.matchPlayer.count({where: {matchId: m.id}});
                                if (playerCount <= 1) {
                                    if (matchAgeMs > LOBBY_STALE_MS) {
                                        info('[sweeper] deleting stale match (age > LOBBY_STALE_MS) with <=1 players', {
                                            matchId: m.id,
                                            status: m.status,
                                            playerCount,
                                            matchAgeMs,
                                            LOBBY_STALE_MS
                                        });
                                        try {
                                            await prisma.matchPlayer.deleteMany({where: {matchId: m.id}});
                                        } catch (e) {
                                            try {
                                                error('[sweeper] failed to delete matchPlayers for stale match', {
                                                    matchId: m.id,
                                                    err: e
                                                });
                                            } catch {
                                            }
                                        }
                                        try {
                                            await prisma.match.delete({where: {id: m.id}});
                                        } catch (e) {
                                            error('[sweeper] failed to delete stale match', {matchId: m.id, err: e});
                                        }
                                    } else {
                                        debug('[sweeper] match with <=1 players is not old enough to delete, skipping', {
                                            matchId: m.id,
                                            playerCount,
                                            matchAgeMs,
                                            LOBBY_STALE_MS
                                        });
                                    }
                                } else {
                                    info('[sweeper] marking stale QUEUE/LOBBY match as CANCELLED', {
                                        matchId: m.id,
                                        status: m.status,
                                        playerCount
                                    });
                                    try {
                                        await prisma.match.update({
                                            where: {id: m.id},
                                            data: {status: MatchStatus.CANCELLED}
                                        });
                                    } catch (e) {
                                        error('[sweeper] failed to cancel stale match', {matchId: m.id, err: e});
                                    }
                                }
                            }
                        } catch (err) {
                            error('[sweeper] failed to process stale match', {matchId: m.id, err});
                        }
                    }
                }
            }
        } catch (err) {
            error('[sweeper] error during match sweep', err);
        }
    }, SWEEP_INTERVAL_MS);

    process.on('exit', () => clearInterval(sweeper));

    const DIAG_INTERVAL_MS = 60_000;
    const diagScanner = setInterval(async () => {
        try {
            if (!(process.env.LOG_DEBUG === '1' || process.env.LOG_DEBUG === 'true')) return;
            for (const [room, peers] of roomPeers.entries()) {
                if (!room.startsWith('match:')) continue;
                const matchId = room.slice('match:'.length);
                try {
                    const m = await prisma.match.findUnique({where: {id: matchId}});
                    if (!m) continue;
                    if (m.status !== MatchStatus.RUNNING) {
                        debug('[ws-diagnostic] room has peers but match not RUNNING', {
                            matchId,
                            status: m.status,
                            peers: Array.from(peers)
                        });
                    }
                } catch (err) {
                    try {
                        error('[ws-diagnostic] failed to inspect match', {matchId, err});
                    } catch {
                    }
                }
            }
        } catch (err) {
            try {
                error('[ws-diagnostic] diagnostic scanner failed', err);
            } catch {
            }
        }
    }, DIAG_INTERVAL_MS);

    process.on('exit', () => clearInterval(diagScanner));
}

const battleAckExpected = new Map<string, Set<string>>();
const battleAckReceived = new Map<string, Set<string>>();
const battleAckTimeouts = new Map<string, NodeJS.Timeout>();
const BATTLE_ACK_TIMEOUT_MS = 5000;

export function postBattleSchedule(matchId: string, round: number, expectedUserIds: string[]) {
    const key = `${matchId}:${round}`;
    battleAckExpected.set(key, new Set(expectedUserIds));
    battleAckReceived.set(key, new Set());
    const prev = battleAckTimeouts.get(key);
    if (prev) {
        clearTimeout(prev);
        battleAckTimeouts.delete(key);
    }
    const t = setTimeout(async () => {
        try {
            info('[battleAck] timeout expired, scheduling round timeout', {matchId, round});
            await scheduleRoundTimeout(matchId);
        } catch (err) {
            error('[battleAck] failed to schedule round timeout after ack timeout', {matchId, round, err});
        } finally {
            battleAckExpected.delete(key);
            battleAckReceived.delete(key);
            battleAckTimeouts.delete(key);
        }
    }, BATTLE_ACK_TIMEOUT_MS);
    battleAckTimeouts.set(key, t);
}

export async function recordBattleDone(matchId: string, round: number, userId: string) {
    const key = `${matchId}:${round}`;
    const expected = battleAckExpected.get(key);
    if (!expected) return;
    const received = battleAckReceived.get(key) ?? new Set<string>();
    received.add(userId);
    battleAckReceived.set(key, received);
    let all = true;
    for (const u of expected) if (!received.has(u)) {
        all = false;
        break;
    }
    if (all) {
        const t = battleAckTimeouts.get(key);
        if (t) {
            clearTimeout(t);
            battleAckTimeouts.delete(key);
        }
        try {
            info('[battleAck] all clients acknowledged, scheduling round timeout', {matchId, round});
            await scheduleRoundTimeout(matchId);
        } catch (err) {
            error('[battleAck] failed to schedule round timeout after all acks', {matchId, round, err});
        } finally {
            battleAckExpected.delete(key);
            battleAckReceived.delete(key);
        }
    }
}

/**
 * chat.ts
 *
 * WebSocket handlers to manage chat and match join flow:
 * - `handleMatchJoin` validates permissions and joins the connection to a match room,
 *   sends recent chat history and a match state snapshot when available.
 * - `handleChatSend` persists and broadcasts a chat message.
 * - `handleChatHistoryRequest` returns recent chat messages for a match.
 */

import type { WebSocket } from "ws";
import type { ClientMsg } from "../protocol.js";
import { prisma } from "../../db/prisma.js";
import { send, broadcastRoom, joinRoom, connections } from "../registry.js";
import { getSerializedMatchStateSnapshots } from "../matchBroadcast.js";
import { MatchStatus } from "@prisma/client";
import { debug } from "../../logging.js";

const matchRoom = (matchId: string) => `match:${matchId}`;

export async function handleMatchJoin(
    ws: WebSocket,
    connId: string,
    msg: Extract<ClientMsg, { type: "MATCH_JOIN" }>,
    userId: string,
): Promise<void> {
    const room = matchRoom(msg.matchId);
    const ctx = connections.get(connId);
    if (ctx && ctx.rooms.has(room)) {
        debug('[ws] duplicate MATCH_JOIN ignored', { connId, userId, matchId: msg.matchId });
        try {
            send(ws, { type: "MATCH_JOINED", matchId: msg.matchId });
        } catch {}
        try {
            const snaps = await getSerializedMatchStateSnapshots(msg.matchId);
            if (snaps && Array.isArray(snaps)) {
                const snap = snaps.find((s) => s.self.userId === userId);
                if (snap) send(ws, { type: "MATCH_STATE", v: 1, ...snap });
            }
        } catch (err) {
            debug('[ws] duplicate MATCH_JOIN snapshot send failed', { connId, userId, matchId: msg.matchId, err });
        }
        return;
    }
    const match = await prisma.match.findUnique({ where: { id: msg.matchId } });
    if (!match) {
        debug('[ws] MATCH_JOIN rejected - match not found', { connId, userId, matchId: msg.matchId });
        return send(ws, { type: "ERROR", code: "MATCH_NOT_FOUND" });
    }
    const LOBBY_STALE_MS = Number(process.env.LOBBY_STALE_MS ?? (5 * 60 * 1000));
    if (match.status === 'LOBBY' || match.status === 'QUEUE') {
        try {
            const playerCount = await prisma.matchPlayer.count({ where: { matchId: msg.matchId } });
            const createdAt = (match as any).createdAt ? new Date((match as any).createdAt).getTime() : Date.now();
            const age = Date.now() - createdAt;
            if (playerCount <= 1 && age > LOBBY_STALE_MS) {
                debug('[ws] MATCH_JOIN rejected - match stale', { connId, userId, matchId: msg.matchId, status: match.status, playerCount, age, LOBBY_STALE_MS });
                return send(ws, { type: "ERROR", code: "MATCH_STALE" });
            }
        } catch (err) {
            debug('[ws] failed to evaluate match stale criteria', { connId, userId, matchId: msg.matchId, err });
        }
    }
    if (match.status === MatchStatus.FINISHED || match.status === MatchStatus.CANCELLED) {
        debug('[ws] MATCH_JOIN rejected - match finished/cancelled', { connId, userId, matchId: msg.matchId, status: match.status });
        return send(ws, { type: "ERROR", code: "MATCH_NOT_AVAILABLE" });
    }
    const participant = await prisma.matchPlayer.findFirst({ where: { matchId: msg.matchId, userId } });
    if (!participant) {
        debug('[ws] MATCH_JOIN rejected - user not a participant', { connId, userId, matchId: msg.matchId });
        return send(ws, { type: "ERROR", code: "NOT_A_PLAYER" });
    }
    joinRoom(connId, room);
    const history = await prisma.chatMessage.findMany({
        where: { matchId: msg.matchId },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { user: true },
    });
    try {
        ws.send(
            JSON.stringify({
                type: "CHAT_HISTORY",
                matchId: msg.matchId,
                messages: history.reverse().map((m) => ({
                    userId: m.userId,
                    username: m.user.username,
                    text: m.text,
                    ts: m.createdAt.getTime(),
                })),
            }),
        );
    } catch {}
    try {
        ws.send(JSON.stringify({ type: "MATCH_JOINED", matchId: msg.matchId }));
    } catch {}
    try {
        const snaps = await getSerializedMatchStateSnapshots(msg.matchId);
        if (snaps && Array.isArray(snaps)) {
            const snap = snaps.find((s) => s.self.userId === userId);
            if (snap) {
                try {
                    const ctx2 = connections.get(connId);
                    if (ctx2) ctx2.suppressBroadcastUntil = Date.now() + 500;
                } catch {}
                try {
                    ws.send(JSON.stringify({ type: "MATCH_STATE", v: 1, ...snap }));
                } catch {}
            }
        }
    } catch (err) {
        debug('[ws] MATCH_JOIN snapshot fetch failed', { connId, userId, matchId: msg.matchId, err });
    }
}

export async function handleChatSend(
    ws: WebSocket,
    connId: string,
    msg: Extract<ClientMsg, { type: "CHAT_SEND" }>,
    userId: string,
): Promise<void> {
    await prisma.chatMessage.create({
        data: {
            matchId: msg.matchId,
            userId,
            text: msg.text,
        },
    });

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
    });

    broadcastRoom(matchRoom(msg.matchId), {
        type: "CHAT_MSG",
        matchId: msg.matchId,
        fromUserId: userId,
        username: user?.username ?? null,
        text: msg.text,
        ts: Date.now(),
    });
}

export async function handleChatHistoryRequest(
    ws: WebSocket,
    connId: string,
    msg: any,
    userId: string,
): Promise<void> {
    const matchId = String(msg.matchId ?? '');
    if (!matchId) {
        try { send(ws, { type: 'ERROR', code: 'MATCH_ID_REQUIRED' } as any); } catch {}
        return;
    }

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) {
        return send(ws, { type: 'ERROR', code: 'MATCH_NOT_FOUND' } as any);
    }

    const participant = await prisma.matchPlayer.findFirst({ where: { matchId, userId } });
    if (!participant) {
        return send(ws, { type: 'ERROR', code: 'NOT_A_PLAYER' } as any);
    }

    const history = await prisma.chatMessage.findMany({
        where: { matchId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { user: true },
    });

    try {
        ws.send(
            JSON.stringify({
                type: 'CHAT_HISTORY',
                matchId,
                messages: history.reverse().map((m) => ({
                    userId: m.userId,
                    username: m.user.username,
                    text: m.text,
                    ts: m.createdAt.getTime(),
                })),
            }),
        );
    } catch {}
}

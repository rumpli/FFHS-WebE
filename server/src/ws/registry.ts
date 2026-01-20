/**
 * registry.ts
 *
 * In-memory registry for WebSocket connections and room membership.
 * - `connections` maps connId -> WsCtx (metadata + WebSocket instance).
 * - `roomPeers` maps room string -> set of connIds that joined the room.
 *
 * Also provides helpers to join/leave rooms, broadcast to a room, and find
 * active connections by user id.
 */

import type {WebSocket} from "ws";
import {debug, error} from "../logging.js";

export type WsState = "ANON" | "AUTH";

export type WsCtx = {
    connId: string;
    ws: WebSocket;
    state: WsState;
    userId: string | null;
    rooms: Set<string>;
    connectedAt: number;
    suppressBroadcastUntil?: number;
};

export const connections = new Map<string, WsCtx>();
export const roomPeers = new Map<string, Set<string>>();

export function joinRoom(connId: string, room: string) {
    const ctx = connections.get(connId);
    if (!ctx) return;
    ctx.rooms.add(room);
    if (!roomPeers.has(room)) roomPeers.set(room, new Set());
    roomPeers.get(room)!.add(connId);
}

export function leaveAllRooms(connId: string) {
    const ctx = connections.get(connId);
    if (!ctx) return;
    for (const r of ctx.rooms) {
        const peers = roomPeers.get(r);
        if (!peers) continue;
        peers.delete(connId);
        if (peers.size === 0) {
            roomPeers.delete(r);
        }
    }
    ctx.rooms.clear();
}

export function broadcastRoom(room: string, payload: any): string[] {
    const set = roomPeers.get(room);
    if (!set) {
        debug("[ws] broadcastRoom", room, "no peers", {
            payloadType: payload?.type,
        });
        return [];
    }
    const msg = JSON.stringify(payload);
    const peers = Array.from(set);
    debug("[ws] broadcastRoom", room, {
        payloadType: payload?.type,
        peers,
    });
    const sent: string[] = [];
    for (const id of set) {
        const ctx = connections.get(id);
        if (!ctx) continue;
        if (ctx.ws.readyState === ctx.ws.OPEN) {
            try {
                ctx.ws.send(msg);
                sent.push(id);
            } catch (err) {
                error('[ws] broadcastRoom: failed to send to conn', {connId: id, userId: ctx.userId, err});
            }
        } else {
            debug('[ws] broadcastRoom: connection not open', {
                connId: id,
                userId: ctx.userId,
                readyState: ctx.ws.readyState
            });
        }
    }
    return sent;
}

export function send(ws: WebSocket, payload: any) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

export function getByUserId(userId: string): WsCtx | undefined {
    for (const ctx of connections.values()) {
        if (ctx.userId === userId) return ctx;
    }
    return undefined;
}

export function isUserConnected(userId: string): boolean {
    const ctx = getByUserId(userId);
    if (!ctx) return false;
    return ctx.ws.readyState === ctx.ws.OPEN;
}

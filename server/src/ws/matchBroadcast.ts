/**
 * matchBroadcast.ts
 *
 * Utilities to build and broadcast per-player match state snapshots. Implements
 * a lightweight per-match broadcast lock (`broadcastLocks`) so that expensive
 * snapshot construction is not performed concurrently and broadcasts are
 * serialized.
 */

import {connections} from "./registry.js";
import {buildMatchStateSnapshots} from "./matchState.js";
import type {WsMatchStateMsg} from "../../../shared/protocol/types/match.js";
import {debug, error} from "../logging.js";

const LOG_DEBUG = process.env.LOG_DEBUG === "1";
const broadcastLocks = new Map<string, Promise<void>>();
const lastBroadcastAt = new Map<string, number>();

export async function getMatchStateSnapshots(matchId: string) {
    return buildMatchStateSnapshots(matchId);
}

export async function getSerializedMatchStateSnapshots(matchId: string) {
    const prev = broadcastLocks.get(matchId) ?? Promise.resolve();
    const p = prev.then(() => buildMatchStateSnapshots(matchId));
    const filler = p.then(() => {
    }).catch(() => {
    });
    broadcastLocks.set(matchId, filler.finally(() => {
        if (broadcastLocks.get(matchId) === filler) broadcastLocks.delete(matchId);
    }));
    return p;
}

export async function runWithBroadcastLock<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
    const prev = broadcastLocks.get(matchId) ?? Promise.resolve();

    const holder = prev.then(async () => {
        return await fn();
    });
    const filler = holder.then(() => {
    }).catch(() => {
    });
    broadcastLocks.set(matchId, filler.finally(() => {
        if (broadcastLocks.get(matchId) === filler) broadcastLocks.delete(matchId);
    }));
    return holder;
}

export async function broadcastMatchState(matchId: string) {
    const prev = broadcastLocks.get(matchId) ?? Promise.resolve();
    const next = prev.then(async () => {
        const snapshots = await getMatchStateSnapshots(matchId);
        if (!snapshots) return;
        if (LOG_DEBUG) {
            const debugList = snapshots
                .map((s) => s.self.userId ?? "<unknown>")
                .join(", ");
            debug("[ws] MATCH_STATE broadcast", {
                matchId,
                round: snapshots[0]?.round,
                userIds: debugList,

                perUser: snapshots.map((s) => ({
                    userId: s.self.userId,
                    round: s.round,
                    roundTimerTs: s.self.roundTimerTs
                })),
            });
        }

        for (const snap of snapshots) {
            const userId = snap.self.userId;
            if (!userId) continue;

            const msg: WsMatchStateMsg = {
                type: "MATCH_STATE",
                v: 1,
                matchId: snap.matchId,
                phase: snap.phase,
                round: snap.round,
                self: snap.self,
                players: snap.players,
            };

            for (const ctx of connections.values()) {
                if (ctx.userId !== userId) continue;
                if (typeof ctx.suppressBroadcastUntil === 'number' && Date.now() < ctx.suppressBroadcastUntil) continue;
                if (ctx.ws.readyState !== ctx.ws.OPEN) continue;
                try {
                    ctx.ws.send(JSON.stringify(msg));
                    debug('[ws] SENT MATCH_STATE to', userId, ctx.connId, {
                        round: msg.round,
                        roundTimerTs: msg.self.roundTimerTs,
                        gold: msg.self.gold
                    });
                } catch (err) {
                    error(
                        "Failed to send MATCH_STATE to user connection",
                        snap.self.userId,
                        ctx.connId,
                        err,
                    );
                }
            }
        }
    }).catch((err) => {
        error("broadcastMatchState failed", matchId, err);
    });
    broadcastLocks.set(matchId, next.finally(() => {
        try {
            lastBroadcastAt.set(matchId, Date.now());
        } catch {
        }
        if (broadcastLocks.get(matchId) === next) broadcastLocks.delete(matchId);
    }));
    return next;
}

export function getLastBroadcastAt(matchId: string): number | null {
    const v = lastBroadcastAt.get(matchId);
    return typeof v === 'number' ? v : null;
}

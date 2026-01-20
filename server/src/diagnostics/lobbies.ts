/**
 * lobbies.ts
 *
 * Periodic diagnostics for lobby cleanup. Scans active lobbies and prunes
 * those that are stale (no connected players and last seen times older than
 * the configured threshold). When a lobby is pruned we increment a metric and
 * broadcast a `LOBBY_STATE` update to notify clients.
 */

import {prisma} from '../db/prisma.js';
import {isUserConnected, broadcastRoom} from '../ws/registry.js';
import {lobbiesPrunedCounter} from '../observability/metrics.js';
import {error, info} from "../logging.js";

const DEFAULT_INACTIVE_MINUTES = Number(process.env.LOBBY_MAX_INACTIVE_MINUTES ?? '10');

export async function runLobbyDiagnostics() {
    const cutoff = new Date(Date.now() - DEFAULT_INACTIVE_MINUTES * 60 * 1000);
    const lobbies = await prisma.lobby.findMany({
        where: {status: {in: ['OPEN', 'STARTED']}},
        include: {players: true},
    });

    for (const l of lobbies) {
        try {
            await inspectAndMaybeCleanup(l.id, cutoff);
        } catch (e) {
            error('lobby diagnostics failed for', l.id, e);
        }
    }
}

async function inspectAndMaybeCleanup(lobbyId: string, cutoff: Date) {
    const lobby = await prisma.lobby.findUnique({where: {id: lobbyId}, include: {players: true}});
    if (!lobby) return;
    if (!lobby.players || lobby.players.length === 0) {
        await deleteLobbyIfStillStale(lobbyId);
        return;
    }
    // If any player is currently connected we keep the lobby
    for (const p of lobby.players) {
        if (isUserConnected(p.userId)) return;
    }
    // Check last-seen timestamps on players; if all are older than cutoff they are stale
    let allStale = true;
    for (const p of lobby.players as any) {
        if (p.lastSeenAt) {
            const last = new Date(p.lastSeenAt);
            if (last > cutoff) {
                allStale = false;
                break;
            }
        }
    }
    if (allStale) {
        await deleteLobbyIfStillStale(lobbyId);
    }
}

async function deleteLobbyIfStillStale(lobbyId: string) {
    try {
        const deleted = await prisma.$transaction(async (tx) => {
            const fresh = await tx.lobby.findUnique({where: {id: lobbyId}, include: {players: true}});
            if (!fresh) return null;
            // Double-check: if anyone reconnected in the meantime, abort
            for (const p of fresh.players) {
                if (isUserConnected(p.userId)) return null;
            }
            for (const p of fresh.players as any) {
                if (p.lastSeenAt) {
                    const last = new Date(p.lastSeenAt);
                    const cutoff = new Date(Date.now() - DEFAULT_INACTIVE_MINUTES * 60 * 1000);
                    if (last > cutoff) return null;
                }
            }
            await tx.lobby.delete({where: {id: lobbyId}});
            return true;
        });

        if (deleted) {
            try {
                lobbiesPrunedCounter.inc();
            } catch (e) {
            }
            try {
                broadcastRoom(`lobby:${lobbyId}`, {type: 'LOBBY_STATE', lobby: null});
            } catch (e) {
            }
            info('deleted stale lobby', lobbyId);
            return true;
        }
    } catch (e) {
        error('failed to delete stale lobby', lobbyId, e);
    }
    return false;
}

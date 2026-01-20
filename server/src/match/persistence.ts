/**
 * persistence.ts
 *
 * Helpers to build and persist canonical match results. `buildMatchResult`
 * reconstructs a `StoredMatchResult` from DB entities (players, rounds, actions)
 * while `persistMatchResult` writes the result into the `match.result` JSON
 * column and updates per-player aggregates and metrics.
 */

import {prisma} from '../db/prisma.js';
import type {
    StoredMatchResult,
    StoredPlayerMatchStats,
    StoredRound
} from '../../../shared/protocol/types/matchResult.js';
import {MatchStatus, Prisma} from '@prisma/client';
import {debug, error} from '../logging.js';
import {matchDurationHistogram, matchesActiveGauge} from '../observability/metrics.js';

export async function buildMatchResult(matchId: string): Promise<StoredMatchResult | null> {
    const match = (await prisma.match.findUnique({
        where: {id: matchId},
        include: {
            players: {include: {user: true}},
            rounds: {orderBy: {round: 'asc'}},
            actions: {orderBy: {createdAt: 'asc'}},
        },
    })) as any;
    if (!match) return null;
    const players = (match.players ?? []).map((p: any) => {
        const persistedStats = (p as any).stats ?? null;
        const damageOut = persistedStats && typeof persistedStats.damageOut === 'number'
            ? Number(persistedStats.damageOut)
            : Number(p.totalDamageOut ?? 0);
        const damageIn = persistedStats && typeof persistedStats.damageIn === 'number'
            ? Number(persistedStats.damageIn)
            : Number(p.totalDamageTaken ?? 0);
        const stats: StoredPlayerMatchStats = {
            userId: p.userId,
            username: p.user?.username ?? null,
            seat: p.seat ?? undefined,
            finalRank: p.finalRank ?? undefined,
            stats: {
                damageOut: damageOut,
                damageIn: damageIn,
                towersDestroyed: undefined,
                towersBuilt: undefined,
                goldEarned: p.goldEarned ?? 0,
            },
            roundStats: undefined,
        };
        return stats;
    });
    const rounds: StoredRound[] = (match.rounds ?? []).map((r: any) => ({
        round: r.round,
        summary: r.summary ?? undefined,
        state: r.state ?? undefined,
        replay: r.replay ?? undefined,
    }));
    const startedAt = match.startedAt ?? match.createdAt;
    const finishedAt = match.finishedAt ?? (match.status === MatchStatus.FINISHED ? new Date() : null);
    const durationMs = finishedAt && startedAt ? (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) : null;
    let inferredWinnerId: string | null = null;
    if (match.winnerId) {
        inferredWinnerId = match.winnerId;
    } else {
        try {
            const byFinal = (match.players ?? []).find((p: any) => typeof p.finalRank === 'number' && p.finalRank === 1);
            if (byFinal && byFinal.userId) inferredWinnerId = byFinal.userId;
            else {
                const survivors = (match.players ?? []).filter((p: any) => !p.isEliminated);
                if (survivors.length === 1 && survivors[0].userId) inferredWinnerId = survivors[0].userId;
            }
        } catch (e) {

        }
    }
    return {
        matchId: match.id,
        createdAt: new Date(match.createdAt).toISOString(),
        startedAt: startedAt ? new Date(startedAt).toISOString() : null,
        finishedAt: finishedAt ? new Date(finishedAt).toISOString() : null,
        durationMs: durationMs ?? null,
        winnerId: inferredWinnerId ?? null,
        players,
        rounds,
        summary: undefined,
    };
}

/**
 * Persist the match result for a given matchId.
 *
 * This function updates the match's result, winnerId, and finishedAt fields in the database,
 * and also updates the per-player aggregates such as gamesPlayed and gamesWon. Additionally,
 * it observes the match duration in the metrics and decrements the active matches gauge.
 *
 * @param matchId - The ID of the match to persist the result for.
 */
export async function persistMatchResult(matchId: string): Promise<void> {
    try {
        const m = (await prisma.match.findUnique({where: {id: matchId}})) as any;
        if (!m) {
            debug('[persist] match not found', {matchId});
            return;
        }
        if (m.result) {
            debug('[persist] match already has result, skipping', {matchId});
            return;
        }
        if (m.status !== MatchStatus.FINISHED) {
            debug('[persist] match not finished yet, skipping', {matchId, status: m.status});
            return;
        }
        const built = await buildMatchResult(matchId);
        if (!built) {
            debug('[persist] buildMatchResult returned null', {matchId});
            return;
        }
        const updatePayload: any = {result: built as any};
        if (built.finishedAt) updatePayload.finishedAt = new Date(built.finishedAt);
        if (built.winnerId) updatePayload.winnerId = built.winnerId;
        const updated = await prisma.match.updateMany({
            where: {id: matchId, result: {equals: Prisma.JsonNull}},
            data: updatePayload as any,
        });
        if (!updated || (updated as any).count === 0) {
            debug('[persist] no rows updated (possibly already persisted by another runner), skipping post-persist steps', {matchId});
            return;
        }
        try {
            const cardCounts = await Promise.all(built.players.map(async (p) => {
                try {
                    const cnt = await prisma.matchAction.count({
                        where: {
                            matchId,
                            type: 'PLAY_CARDS',
                            player: {userId: p.userId}
                        }
                    });
                    return Number(cnt || 0);
                } catch (e) {
                    return 0;
                }
            }));
            for (let i = 0; i < built.players.length; i++) {
                try {
                    const p = built.players[i];
                    if (!p.stats) p.stats = {} as any;
                    (p.stats as any).cardsPlayed = cardCounts[i] ?? 0;
                } catch (e) {
                }
            }
        } catch (e) {
            debug('[persist] failed to compute per-player cardsPlayed', {matchId, err: e});
        }
        for (const p of built.players) {
            try {
                await prisma.matchPlayer.updateMany({
                    where: {matchId, userId: p.userId},
                    data: ({stats: p.stats as any}) as any
                });
            } catch (e) {
                error('[persist] failed to update MatchPlayer.stats', {matchId, userId: p.userId, err: e});
            }
        }
        try {
            const winnerId = built.winnerId ?? null;
            for (const p of built.players) {
                try {
                    const updateData: any = {gamesPlayed: {increment: 1}};
                    if (winnerId && String(winnerId) === String(p.userId)) {
                        updateData.gamesWon = {increment: 1};
                    }
                    await prisma.user.updateMany({where: {id: p.userId}, data: updateData});
                } catch (e) {
                    error('[persist] failed to update user aggregates (gamesPlayed/gamesWon)', {
                        matchId,
                        userId: p.userId,
                        err: e
                    });
                }
            }
        } catch (e) {
            error('[persist] failed to persist per-user aggregates after match persist', {matchId, err: e});
        }
        try {
            if (built.durationMs !== null && typeof built.durationMs === 'number') {
                matchDurationHistogram.observe((built.durationMs || 0) / 1000);
            }
        } catch (e) {
        }
        try {
            matchesActiveGauge.dec();
        } catch (e) {
        }
        debug('[persist] match result persisted', {matchId});
    } catch (err) {
        error('[persist] persistMatchResult failed', {matchId, err});
        throw err;
    }
}

/**
 * profile.ts
 *
 * Handler to serve a player's public profile and match history. The route
 * `/api/players/:playerId/profile` validates that the requesting user is the
 * same player (private profile access), aggregates match and stats data and
 * returns a compact `profile` object alongside paginated match summaries.
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { getUserFromRequest } from '../../auth/httpAuth.js';

export async function registerProfileRoutes(app: FastifyInstance) {
    app.get('/api/players/:playerId/profile', async (req, reply) => {
        const playerId = String((req.params as any).playerId);
        // Ensure the caller is authenticated and authorized to view this profile
        const authUser = await getUserFromRequest(req);
        if (!authUser) return reply.code(401).send({ ok: false, error: 'UNAUTHENTICATED' });
        if (String(authUser.id) !== String(playerId))
            return reply.code(403).send({ ok: false, error: 'FORBIDDEN' });
        // Fetch canonical user summary
        const user = await prisma.user.findUnique({
            where: { id: playerId },
            select: {
                id: true,
                username: true,
                createdAt: true,
                xp: true,
                level: true,
                gamesPlayed: true,
                gamesWon: true,
                totalDamageOut: true,
                totalDamageTaken: true,
                maxSurvivalRound: true,
            },
        });
        if (!user) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
        // Reuse matchPlayer rows to compute some aggregates (fallbacks applied below)
        const mpRows = await prisma.matchPlayer
            .findMany({
                where: { userId: playerId },
                select: { matchId: true, finalRank: true, stats: true },
            })
            .catch(() => [] as any[]);
        const totalMatches = mpRows.length;
        const gamesPlayed = totalMatches;
        const wonMatchIds = new Set<string>();
        for (const r of mpRows) {
            try {
                if (typeof r.finalRank === 'number' && r.finalRank === 1 && r.matchId) wonMatchIds.add(r.matchId);
            } catch {
                // ignore
            }
            try {
                const s = (r as any).stats ?? null;
                if (s && typeof s.cardsPlayed === 'number') {
                    // no-op (kept for backward-compat with older stats shapes)
                }
            } catch {
                // ignore
            }
        }
        try {
            const winnerMatches = await prisma.match.findMany({
                where: { winnerId: playerId },
                select: { id: true },
            });
            for (const m of winnerMatches) if (m.id) wonMatchIds.add(m.id);
        } catch {
            // ignore
        }
        const gamesWon = wonMatchIds.size;
        // Compute cardsPlayed: prefer explicit action counts, fall back to stored stats
        let cardsPlayed: number;
        try {
            cardsPlayed = (await prisma.matchAction.count({
                where: {
                    type: 'PLAY_CARDS',
                    player: { userId: playerId },
                },
            })) || 0;
        } catch {
            cardsPlayed = 0;
        }
        if (!cardsPlayed) {
            try {
                for (const r of mpRows) {
                    const s = (r as any).stats ?? null;
                    if (s && typeof s.cardsPlayed === 'number') cardsPlayed += Number(s.cardsPlayed || 0);
                }
            } catch {
                cardsPlayed = 0;
            }
        }
        const roundsPlayed = await prisma.matchRound
            .count({ where: { match: { players: { some: { userId: playerId } } } } })
            .catch(() => 0);
        const dmgSum = await prisma.matchPlayer
            .aggregate({
                _sum: { totalDamageOut: true, totalDamageTaken: true },
                where: { userId: playerId },
            })
            .catch(() => ({} as any));
        let totalDamageOut = Number((dmgSum as any)._sum?.totalDamageOut ?? 0);
        let totalDamageTaken = Number((dmgSum as any)._sum?.totalDamageTaken ?? 0);
        try {
            if ((!totalDamageOut || totalDamageOut === 0) && typeof (user as any).totalDamageOut === 'number') {
                totalDamageOut = (user as any).totalDamageOut;
            }
            if ((!totalDamageTaken || totalDamageTaken === 0) && typeof (user as any).totalDamageTaken === 'number') {
                totalDamageTaken = (user as any).totalDamageTaken;
            }
        } catch {
            // ignore
        }
        if ((totalDamageOut === 0 && totalDamageTaken === 0) || totalDamageOut === 0 || totalDamageTaken === 0) {
            try {
                const allRows = await prisma.matchPlayer.findMany({
                    where: { userId: playerId },
                    include: { match: { select: { result: true } } },
                });
                for (const r of allRows) {
                    try {
                        const mr = (r.match as any)?.result ?? null;
                        if (mr && Array.isArray(mr.players)) {
                            const me = (mr.players as any[]).find((p: any) => String(p.userId) === String(playerId));
                            if (me && me.stats) {
                                const dOut = Number(me.stats.damageOut ?? 0);
                                const dIn = Number(me.stats.damageIn ?? 0);
                                if (dOut) totalDamageOut += dOut;
                                if (dIn) totalDamageTaken += dIn;
                            }
                        }
                    } catch {
                        // ignore
                    }
                }
            } catch {
                // ignore
            }
        }

        // match history: reuse matchPlayer rows with pagination, include match.players.user to derive opponents
        const limit = Math.min(Number((req.query as any).limit ?? 20), 100);
        const page = Math.max(Number((req.query as any).page ?? 1), 1);
        const skip = (page - 1) * limit;

        const rows = await prisma.matchPlayer.findMany({
            where: { userId: playerId },
            include: {
                match: {
                    select: {
                        id: true,
                        createdAt: true,
                        finishedAt: true,
                        result: true,
                        status: true,
                        players: {
                            select: {
                                userId: true,
                                finalRank: true,
                                totalDamageOut: true,
                                user: { select: { id: true, username: true } },
                            },
                        },
                    },
                },
            },
            orderBy: { id: 'desc' },
            take: limit,
            skip,
        });

        const matchSummaries = rows.map((r) => {
            const match = (r.match as any) ?? null;
            let opponents: any[] = [];
            try {
                const mp = match?.players ?? null;
                if (Array.isArray(mp) && mp.length > 0) {
                    opponents = mp
                        .filter((p: any) => String(p.userId) !== String(playerId))
                        .map((p: any) => ({
                            userId: p.userId,
                            username: p.user?.username ?? null,
                            finalRank: p.finalRank,
                            totalDamageOut: p.totalDamageOut,
                        }));
                } else {
                    const mr = match?.result ?? null;
                    if (mr && Array.isArray(mr.players)) {
                        opponents = (mr.players as any[])
                            .filter((p: any) => String(p.userId) !== String(playerId))
                            .map((p: any) => ({
                                userId: p.userId,
                                username: p.username ?? null,
                                finalRank: p.finalRank,
                                totalDamageOut: p.stats?.damageOut ?? 0,
                            }));
                    }
                }
            } catch {
                opponents = [];
            }

            let opponentsLabel = '—';
            try {
                if (Array.isArray(opponents) && opponents.length > 0) {
                    const names = opponents.map((o: any) => o.username || o.userId || '—').filter(Boolean);
                    if (names.length === 1) opponentsLabel = names[0];
                    else if (names.length === 2) opponentsLabel = `${names[0]}, ${names[1]}`;
                    else opponentsLabel = `${names.length} players`;
                }
            } catch {
                opponentsLabel = '—';
            }

            let perMatchDamage = 0;
            try {
                if ((r as any).totalDamageOut && (r as any).totalDamageOut > 0) {
                    perMatchDamage = (r as any).totalDamageOut;
                } else if (match && match.result && Array.isArray(match.result.players)) {
                    const me = (match.result.players as any[]).find((p: any) => String(p.userId) === String(playerId));
                    perMatchDamage = me?.stats?.damageOut ?? 0;
                }
            } catch {
                perMatchDamage = 0;
            }

            return {
                matchId: r.matchId,
                createdAt: match ? match.createdAt : null,
                finishedAt: match ? match.finishedAt : null,
                status: match ? match.status : null,
                stats: (r as any).stats,
                finalRank: (r as any).finalRank ?? null,
                totalDamageOut: perMatchDamage,
                matchResult: match ? match.result : null,
                opponents,
                opponentsLabel,
            };
        });

        const hasMore = skip + matchSummaries.length < totalMatches;

        const profile = {
            userId: user.id,
            username: user.username,
            createdAt: user.createdAt.toISOString(),
            xp: user.xp,
            level: user.level,
            gamesPlayed: gamesPlayed || (user as any).gamesPlayed || 0,
            gamesWon: gamesWon || (user as any).gamesWon || 0,
            totalDamageOut,
            totalDamageTaken,
            cardsPlayed,
            roundsPlayed,
            matches: matchSummaries,
        };
        return reply.code(200).send({ ok: true, profile, pagination: { page, limit, hasMore } });
    });
}

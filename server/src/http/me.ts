/**
 * me.ts
 *
 * `/api/me` route that returns the authenticated user's base profile along
 * with any persisted match or lobby state. The endpoint verifies the access
 * token, inspects db for current match/lobby membership and returns a
 * compact payload used by the frontend to restore the user's UI state.
 */

import type {FastifyInstance} from "fastify";
import {getUserFromRequest} from "../auth/httpAuth.js";
import {getCurrentMatchForUserFromDb} from "../match/currentMatch.js";
import {MatchStatus} from "@prisma/client";
import {prisma} from "../db/prisma.js";

export async function registerMeRoutes(app: FastifyInstance) {
    app.get("/api/me", async (req, reply) => {
        const user = await getUserFromRequest(req);
        if (!user) {
            app.log.error({ip: req.ip}, "unauthenticated access to /api/me");
            return reply.code(401).send({ok: false, error: "UNAUTHENTICATED"});
        }

        const currentMatch = await getCurrentMatchForUserFromDb(user.id);

        let matchId: string | null = null;
        let matchStatus: "searching" | "starting" | "running" | null = null;

        if (currentMatch) {
            matchId = currentMatch.id;
            switch (currentMatch.status) {
                case MatchStatus.LOBBY:
                case MatchStatus.QUEUE:
                    matchStatus = "searching";
                    break;
                case MatchStatus.RUNNING:
                    matchStatus = "running";
                    break;
                default:
                    matchStatus = null;
                    matchId = null;
                    break;
            }
        }

        let lobby: {
            lobbyId: string;
            matchId: string | null;
            matchJoinable: boolean;
            role: 'owner' | 'member';
            status: string;
            playerCount: number
        } | null = null;
        try {
            const lp = await prisma.lobbyPlayer.findFirst({
                where: {
                    userId: user.id,
                    lobby: {status: {not: 'CLOSED'} as any},
                },
                orderBy: {joinedAt: 'desc' as any},
                include: {lobby: {include: {owner: true, players: true}}},
            });
            if (lp && lp.lobby) {
                const l = lp.lobby as any;
                let rawMatchId: string | null = l.matchId ?? null;
                let matchJoinable = false;
                try {
                    if (rawMatchId) {
                        const m = await prisma.match.findUnique({
                            where: {id: String(rawMatchId)},
                            select: {id: true, status: true}
                        });
                        matchJoinable = !!m && m.status === MatchStatus.RUNNING;
                    }
                } catch {
                    matchJoinable = false;
                }

                lobby = {
                    lobbyId: l.id,
                    matchId: rawMatchId,
                    matchJoinable,
                    role: l.ownerId === user.id ? 'owner' : 'member',
                    status: l.status,
                    playerCount: Array.isArray(l.players) ? l.players.length : 0,
                };

                if (String(l.status).toUpperCase() === 'CLOSED') {
                    lobby = null;
                }

                if (String(l.status).toUpperCase() === 'STARTED' && rawMatchId && !matchJoinable) {
                    app.log.warn({
                        userId: user.id,
                        lobbyId: l.id,
                        matchId: rawMatchId
                    }, 'user in STARTED lobby but match is not joinable');
                }
            }
        } catch (e) {
            app.log.error({err: e}, 'failed to fetch lobby membership for /api/me');
        }

        app.log.info(
            {userId: user.id, matchId, matchStatus, lobby},
            "fetched current user with match and lobby state"
        );

        return reply.send({
            ok: true,
            user,
            matchId,
            matchStatus,
            lobby,
        });
    });
}

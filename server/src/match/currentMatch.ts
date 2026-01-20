/**
 * currentMatch.ts
 *
 * Helpers to locate the current active match (if any) for a given user by
 * inspecting the `matchPlayer` table for matches in LOBBY/QUEUE/RUNNING states.
 */

import {prisma} from "../db/prisma.js";
import {MatchStatus, type Match} from "@prisma/client";

export type DbCurrentMatch = {
    id: string;
    status: MatchStatus;
    createdAt: Date;
    round: number;
};

/**
 * Query the DB for the most recent active match a user participates in.
 * Returns a compact `DbCurrentMatch` or `null` when none found.
 */
export async function getCurrentMatchForUserFromDb(userId: string): Promise<DbCurrentMatch | null> {
    const matchPlayer = await prisma.matchPlayer.findFirst({
        where: {
            userId,
            match: {
                status: {
                    in: [MatchStatus.LOBBY, MatchStatus.QUEUE, MatchStatus.RUNNING],
                },
            },
        },
        orderBy: {
            match: {
                createdAt: "desc",
            },
        },
        include: {
            match: true,
        },
    });
    if (!matchPlayer || !matchPlayer.match) return null;
    const m: Match = matchPlayer.match as Match;
    return {
        id: m.id,
        status: m.status,
        createdAt: m.createdAt,
        round: m.round,
    };
}

/**
 * profile.ts
 *
 * Public-facing player profile shapes returned by the server's profile APIs.
 * The objects are kept intentionally permissive (using `any` for some fields)
 * to allow evolving statistics without forcing frequent client changes.
 */

export type PlayerMatchSummary = {
    matchId: string;
    createdAt: string | null;
    finishedAt: string | null;
    status: string | null;
    stats?: any; 
};

export type PlayerProfile = {
    userId: string;
    username: string;
    createdAt: string;
    xp: number;
    level: number;
    gamesPlayed: number;
    gamesWon: number;
    totalDamageOut: number;
    totalDamageTaken: number;
    cardsPlayed: number;
    roundsPlayed: number;
    matches: PlayerMatchSummary[];
};

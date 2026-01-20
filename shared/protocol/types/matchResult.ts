/**
 * matchResult.ts
 *
 * Types describing the persisted match result data returned via APIs. The
 * shapes are slightly richer than the in-memory simulator events to allow
 * attaching replay metadata (e.g. simTick or raw event payloads) and to make
 * the persisted payloads stable for clients.
 */

import type { BattleEvent, MatchStateSnapshot } from './match.js';

export interface StoredBattleEvent extends BattleEvent {
    // Optional simulation tick index this event originated from
    simTick?: number;
    // Raw simulator payload (kept for debugging / rehydration)
    raw?: any;
}

export interface StoredRoundReplay {
    events?: StoredBattleEvent[];
    ticksToReach?: number;
    initialUnits?: any[];
    shotsPerTick?: any[];
    perTickSummary?: any[];
}

export interface StoredRound {
    round: number;
    summary?: any;
    events?: StoredBattleEvent[];
    // The saved match state snapshot for the round (optional)
    state?: MatchStateSnapshot | any;
    replay?: StoredRoundReplay;
}

export interface StoredPlayerMatchStats {
    userId: string;
    username?: string | null;
    seat?: number;
    finalRank?: number;
    stats: {
        damageOut: number;
        damageIn: number;
        towersDestroyed?: number;
        towersBuilt?: number;
        goldEarned?: number;
    };
    roundStats?: Array<{ round: number; damageOut: number; damageIn: number; towerHp: number }>;
}

export interface StoredMatchResult {
    matchId: string;
    createdAt: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    durationMs?: number | null;
    winnerId?: string | null;
    players: StoredPlayerMatchStats[];
    rounds: StoredRound[];
    summary?: any;
}

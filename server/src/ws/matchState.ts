/**
 * matchState.ts
 *
 * Utilities for reading and mutating per-player match state. Responsibilities:
 * - Provide a normalized `MatchPlayerStateJson` default and helpers to read/save
 *   JSON blobs stored in the DB.
 * - Helpers to draw cards, shuffle decks, generate shop offers and compute
 *   per-round economic values.
 * - Provide locking helpers (`runWithLocalLock`) and high-level `updatePlayerState`
 *   that performs a safe read-update-write transaction with broadcast locking.
 */

import {MatchPlayer, Prisma, CardRarity} from "@prisma/client";
import {prisma} from "../db/prisma.js";
import type {
    MatchPlayerState,
    MatchPhase,
    MatchSummaryPlayerView,
    MatchStateSnapshot,
} from "../../../shared/protocol/types/match.js";
import {debug} from "../logging.js";

export const MATCH_CONFIG = {
    handSizePerRound: 3,
    maxDrawPerCall: 3,
    ticksToReach: 10,
    towerUpgradeHpBonus: 100,
    towerUpgradeDpsBonus: 5,
} as const;

export type MatchPlayerStateJson = MatchPlayerState;
export function baseGoldForRound(round: number): number {
    const r = Math.max(1, round);
    return Math.min(3 + (r - 1), 10);
}

export const DEFAULT_REROLL_COST = 2;
export const DEFAULT_TOWER_UPGRADE_COST = 8;
export function towerUpgradeCostForRound(currentRound: number, lastUpgradeRound: number): number {
    if (!lastUpgradeRound || lastUpgradeRound <= 0) {
        const decreases = Math.max(0, currentRound - 1);
        const cost = DEFAULT_TOWER_UPGRADE_COST - decreases;
        return Math.max(3, cost);
    }
    const decreases = Math.max(0, currentRound - lastUpgradeRound);
    const cost = DEFAULT_TOWER_UPGRADE_COST - decreases;
    return Math.max(3, cost);
}

export function roundDurationMsForRound(round: number): number {
    const r = Math.max(1, round);
    const baseMs = 20_000;
    const incrementPerRoundMs = 5_000;
    const maxMs = 90_000;
    const duration = baseMs + (r - 1) * incrementPerRoundMs;
    return Math.min(duration, maxMs);
}

export function defaultPlayerState(): MatchPlayerStateJson {
    return {
        towerLevel: 1,
        towerHp: 2000,
        towerHpMax: 2000,
        towerDps: 10,
        round: 1,
        gold: 3,
        rerollCost: DEFAULT_REROLL_COST,
        totalDamageOut: 0,
        totalDamageIn: 0,
        deck: [],
        hand: [],
        discard: [],
        board: Array.from({length: 7}).map(() => ({
            cardId: null,
            stackCount: 0,
        })),
        shop: [],
        phase: "shop",
        roundTimerTs: null,
        lastTowerUpgradeRound: 0,
        pendingExtraDraws: 0,
        goldPerRound: 0,
        maxGold: 10,
    };
}

/**
 * Shuffle an array in place and return it. Uses the Fisher-Yates shuffle algorithm.
 */
export function shuffleArray<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Draw cards from the deck into the hand, up to the specified count.
 * If the discard pile is not empty, it will be shuffled into the deck first.
 */
export function drawCards(
    state: MatchPlayerStateJson,
    count: number,
    handSizeLimit?: number,
): MatchPlayerStateJson {
    const maxHandSize = typeof handSizeLimit === 'number' ? handSizeLimit : MATCH_CONFIG.handSizePerRound;
    const toDraw = Math.min(count, MATCH_CONFIG.maxDrawPerCall);
    for (let i = 0; i < toDraw; i++) {
        if (state.hand.length >= maxHandSize) break;
        if (state.deck.length === 0 && state.discard.length > 0) {
            state.deck = shuffleArray([...state.discard]);
            state.discard = [];
        }
        const card = state.deck.shift();
        if (!card) break;
        state.hand.push(card);
    }
    return state;
}

/**
 * Draw multiple cards, ensuring the hand reaches the desired total count.
 * Will repeatedly draw cards until the hand is full or the desired total is reached.
 */
export function drawMultipleCards(state: MatchPlayerStateJson, desiredTotal: number, handSizeLimit?: number): MatchPlayerStateJson {
    const limit = typeof handSizeLimit === 'number' ? handSizeLimit : desiredTotal;
    while (state.hand.length < Math.min(desiredTotal, limit)) {
        const before = state.hand.length;
        drawCards(state, desiredTotal - state.hand.length, handSizeLimit);
        if (state.hand.length === before) break;
    }
    return state;
}

let cachedCardPool: { id: string; rarity: CardRarity }[] | null = null;
let cachedCardPoolLoadedAt = 0;

/**
 * Get the pool of collectible cards from the database, caching the result for 60 seconds.
 */
async function getCardPool(): Promise<{ id: string; rarity: CardRarity }[]> {
    const now = Date.now();
    if (cachedCardPool && now - cachedCardPoolLoadedAt < 60_000) {
        return cachedCardPool;
    }
    const rows = await prisma.cardDefinition.findMany({
        where: {collectible: true},
        select: {id: true, rarity: true},
    });
    cachedCardPool = rows.map((r) => {
        const raw = r.rarity as CardRarity | null;
        const rarity: CardRarity = raw ?? CardRarity.COMMON;
        return {id: r.id, rarity};
    });
    cachedCardPoolLoadedAt = now;
    return cachedCardPool;
}

/**
 * Build the shop pools by rarity from the card pool.
 */
async function buildShopPools() {
    const pool = await getCardPool();
    const byRarity: Record<CardRarity, string[]> = {
        [CardRarity.COMMON]: [],
        [CardRarity.UNCOMMON]: [],
        [CardRarity.RARE]: [],
        [CardRarity.EPIC]: [],
        [CardRarity.LEGENDARY]: [],
    };
    for (const c of pool) {
        byRarity[c.rarity].push(c.id);
    }
    return byRarity;
}

/**
 * Get the rarity weights for the shop based on the tower level.
 */
function getShopRarityWeights(towerLevel: number): { rarity: CardRarity; weight: number }[] {
    switch (towerLevel) {
        case 1:
            return [
                {rarity: CardRarity.COMMON, weight: 80},
                {rarity: CardRarity.UNCOMMON, weight: 20},
                {rarity: CardRarity.RARE, weight: 0},
                {rarity: CardRarity.EPIC, weight: 0},
                {rarity: CardRarity.LEGENDARY, weight: 0},
            ];
        case 2:
            return [
                {rarity: CardRarity.COMMON, weight: 60},
                {rarity: CardRarity.UNCOMMON, weight: 25},
                {rarity: CardRarity.RARE, weight: 15},
                {rarity: CardRarity.EPIC, weight: 0},
                {rarity: CardRarity.LEGENDARY, weight: 0},
            ];
        case 3:
            return [
                {rarity: CardRarity.COMMON, weight: 40},
                {rarity: CardRarity.UNCOMMON, weight: 25},
                {rarity: CardRarity.RARE, weight: 20},
                {rarity: CardRarity.EPIC, weight: 15},
                {rarity: CardRarity.LEGENDARY, weight: 0},
            ];
        case 4:
            return [
                {rarity: CardRarity.COMMON, weight: 30},
                {rarity: CardRarity.UNCOMMON, weight: 15},
                {rarity: CardRarity.RARE, weight: 30},
                {rarity: CardRarity.EPIC, weight: 20},
                {rarity: CardRarity.LEGENDARY, weight: 5},
            ];
        case 5:
            return [
                {rarity: CardRarity.COMMON, weight: 25},
                {rarity: CardRarity.UNCOMMON, weight: 10},
                {rarity: CardRarity.RARE, weight: 35},
                {rarity: CardRarity.EPIC, weight: 20},
                {rarity: CardRarity.LEGENDARY, weight: 10},
            ];
        default:
            return [
                {rarity: CardRarity.COMMON, weight: 15},
                {rarity: CardRarity.UNCOMMON, weight: 10},
                {rarity: CardRarity.RARE, weight: 30},
                {rarity: CardRarity.EPIC, weight: 25},
                {rarity: CardRarity.LEGENDARY, weight: 20},
            ];
    }
}

/**
 * Pick a rarity based on the weights, using a random roll.
 */
function pickRarity(weights: { rarity: CardRarity; weight: number }[]): CardRarity {
    const total = weights.reduce((sum, r) => sum + r.weight, 0);
    const roll = Math.random() * total;
    let acc = 0;
    for (const r of weights) {
        acc += r.weight;
        if (roll <= acc) return r.rarity;
    }
    return weights[0].rarity;
}

/**
 * Generate a random shop offer of card IDs, weighted by rarity and limited by the tower level.
 */
export async function randomShopWeighted(size: number, towerLevel: number = 1): Promise<string[]> {
    const result: string[] = [];
    const pools = await buildShopPools();
    const weights = getShopRarityWeights(towerLevel);
    for (let i = 0; i < size; i++) {
        let attempts = 0;
        while (attempts < 5 && result.length <= i) {
            attempts++;
            const rarity = pickRarity(weights);
            const pool = pools[rarity];
            if (!pool.length) continue;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            result.push(pick);
        }
    }
    return result;
}

/**
 * Read and parse the player state from the database model, returning a normalized `MatchPlayerStateJson`.
 */
export function readPlayerState(p: MatchPlayer): MatchPlayerStateJson {
    try {
        const raw = p.state as unknown;
        if (raw && typeof raw === "object") {
            const parsed = raw as any;
            if (
                Array.isArray(parsed.board) &&
                Array.isArray(parsed.deck) &&
                Array.isArray(parsed.hand)
            ) {
                return {
                    ...defaultPlayerState(),
                    ...parsed,
                };
            }
        }
    } catch {
    }
    return defaultPlayerState();
}

/**
 * Convert and flatten the player state to a JSON object suitable for database storage.
 */
export function savePlayerStateJson(p: MatchPlayerStateJson): Prisma.InputJsonValue {
    const board = Array.from({length: 7}).map((_, i) => {
        const slot = p.board[i] ?? {cardId: null, stackCount: 0};
        return {
            cardId: slot.cardId,
            stackCount: slot.stackCount,
        } as { cardId: string | null; stackCount: number };
    });
    return {...(p as unknown as Record<string, unknown>), board} as Prisma.InputJsonValue;
}

/**
 * Update the player state in a safe manner, using local and broadcast locks to prevent race conditions.
 */
export async function updatePlayerState(
    matchId: string,
    userId: string,
    updater: (s: MatchPlayerStateJson) => MatchPlayerStateJson | void,
): Promise<MatchPlayerStateJson | null> {
    let resultState: MatchPlayerStateJson | null = null;
    const local = (runWithLocalLock as any) ?? (async (_: string, fn: () => Promise<any>) => fn());
    const mb = await import("./matchBroadcast.js");
    const runWithBroadcastLock = (mb && (mb.runWithBroadcastLock as any)) ?? (async (_: string, fn: () => Promise<any>) => fn());
    await local(matchId, async () => {
        await runWithBroadcastLock(matchId, async () => {
            await prisma.$transaction(async (tx) => {
                const mp = await tx.matchPlayer.findFirst({
                    where: {matchId, userId},
                });
                if (!mp) return;
                const current = readPlayerState(mp as MatchPlayer);
                const beforeLast = current.lastTowerUpgradeRound;
                const updated = updater(current) ?? current;
                const merged: MatchPlayerStateJson = {...current, ...updated} as MatchPlayerStateJson;
                try {
                    const afterLast = (updated as any).lastTowerUpgradeRound;
                    if (beforeLast !== afterLast) {
                        debug('[matchState] updatePlayerState lastTowerUpgradeRound change', {
                            matchId,
                            userId,
                            beforeLast,
                            afterLast
                        });
                    }
                } catch {
                }
                await tx.matchPlayer.update({
                    where: {id: mp.id},
                    data: {state: savePlayerStateJson(merged)},
                });
                const saved = await tx.matchPlayer.findFirst({where: {id: mp.id}});
                if (saved) resultState = readPlayerState(saved as MatchPlayer);
            });
        });
    });
    return resultState;
}

const localLocks = new Map<string, Promise<void>>();

/**
 * Run a function with a local lock for the specified match ID, ensuring that only one
 * operation can modify the match state at a time.
 */
export async function runWithLocalLock<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
    const prev = localLocks.get(matchId) ?? Promise.resolve();
    const holder = prev.then(async () => fn());
    const filler = holder.then(() => {
    }).catch(() => {
    });
    localLocks.set(matchId, filler.finally(() => {
        if (localLocks.get(matchId) === filler) localLocks.delete(matchId);
    }));
    return holder;
}

/**
 * Snapshot the current round state for a match, including player states and summary data.
 */
export async function snapshotRound(matchId: string, round: number) {
    const match = await prisma.match.findUnique({
        where: {id: matchId},
        include: {players: true},
    });
    if (!match) return;
    const perPlayer = match.players.map((p) => ({
        matchPlayerId: p.id,
        userId: p.userId,
        state: readPlayerState(p as MatchPlayer),
    }));
    const summary: Prisma.InputJsonValue = {
        round,
        players: perPlayer.map((p) => ({
            userId: p.userId,
            totalDamageOut: p.state.totalDamageOut,
            totalDamageIn: p.state.totalDamageIn,
            towerHp: p.state.towerHp,
        })),
    };
    const state = perPlayer as unknown as Prisma.InputJsonValue;
    await prisma.matchRound.upsert({
        where: {matchId_round: {matchId, round}},
        create: {
            matchId,
            round,
            summary,
            state,
        },
        update: {
            summary,
            state,
        },
    });
}

/**
 * Convert the player state to a summary view for transmission to clients.
 */
export function toSummaryPlayerView(
    userId: string,
    username: string | null | undefined,
    seat: number | null | undefined,
    state: MatchPlayerStateJson,
): MatchSummaryPlayerView {
    return {
        userId,
        username: username ?? undefined,
        seat: seat ?? undefined,
        towerLevel: state.towerLevel,
        towerColor: state.towerColor,
        towerHp: state.towerHp,
        towerHpMax: state.towerHpMax,
        totalDamageOut: state.totalDamageOut,
        totalDamageIn: state.totalDamageIn,
    };
}

/**
 * Build match state snapshots for all players in a match, to be used for updating clients.
 */
export async function buildMatchStateSnapshots(
    matchId: string,
): Promise<MatchStateSnapshot[] | null> {
    const match = await prisma.match.findUnique({
        where: {id: matchId},
        include: {
            players: {
                include: {user: true},
                orderBy: {seat: "asc"},
            },
        },
    });
    if (!match) return null;
    const status: string = (match as any).status ?? "";
    const phase: MatchPhase =
        status === "RUNNING"
            ? "shop"
            : status === "FINISHED"
                ? "finished"
                : "lobby";

    const perPlayer = match.players.map((p) => {
        const rawState = readPlayerState(p as MatchPlayer);
        const seat = typeof p.seat === "number" ? p.seat : 0;
        const towerColor: "red" | "blue" = seat === 0 ? "blue" : "red";
        const withEconomy = {
            ...rawState,
            towerUpgradeCost: 0,
            towerColor,
        } as MatchPlayerStateJson;
        return {
            userId: p.userId,
            username: p.user?.username ?? null,
            seat: p.seat ?? null,
            state: withEconomy,
        };
    });

    const rounds = perPlayer.map((p) => Number(p.state?.round ?? 1));
    const commonRound = rounds.length ? Math.max(...rounds) : 1;
    for (const p of perPlayer) {
        p.state.round = commonRound;
        p.state.towerUpgradeCost = towerUpgradeCostForRound(commonRound, p.state.lastTowerUpgradeRound ?? 0);
    }

    const timerValues = perPlayer.map((p) => (typeof p.state.roundTimerTs === "number" ? p.state.roundTimerTs : null)).filter((v) => v !== null) as number[];
    const commonRoundTimerTs = timerValues.length ? Math.max(...timerValues) : null;
    const now = Date.now();
    const serverRoundTimeLeftMs = commonRoundTimerTs !== null ? Math.max(0, commonRoundTimerTs - now) : null;
    if (commonRoundTimerTs !== null) {
        for (const p of perPlayer) {
            p.state.roundTimerTs = commonRoundTimerTs;
            p.state.roundTimeLeftMs = serverRoundTimeLeftMs;
        }
    } else {
        for (const p of perPlayer) {
            p.state.roundTimeLeftMs = null;
        }
    }

    const playersSummary: MatchSummaryPlayerView[] = perPlayer.map((p) =>
        toSummaryPlayerView(p.userId, p.username, p.seat, p.state),
    );

    const snapshots: MatchStateSnapshot[] = perPlayer.map((p) => ({
        matchId,
        phase,
        round: commonRound,
        self: {
            ...p.state,
            userId: p.userId,
            username: p.username ?? undefined,
            seat: p.seat ?? undefined,
        },
        players: playersSummary,
    }));

    debug("[ws] buildMatchStateSnapshots colors", {
        matchId,
        players: perPlayer.map((p) => ({
            userId: p.userId,
            username: p.username,
            seat: p.seat,
            computedSeat: typeof p.seat === "number" ? p.seat : null,
            towerColor: p.state.towerColor,
            gold: p.state.gold,
            lastTowerUpgradeRound: p.state.lastTowerUpgradeRound,
        })),
    });
    return snapshots;
}

/**
 * Get the number of shop offers available based on the tower level.
 */
export function getShopOfferCount(towerLevel: number): number {
    return Math.min(5, Math.max(1, towerLevel));
}

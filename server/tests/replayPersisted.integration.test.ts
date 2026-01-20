/**
 * replayPersisted.integration.test.ts
 *
 * Integration tests verifying that match round replay data is persisted to the
 * database after a round ends. Uses in-memory mocks for DB interactions.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';


const matchId = 'm-replay';
const userA = 'uA';
const userB = 'uB';

let storedMatchRound: any = null;

const inMemoryPlayers: any = {};
let matchRow: any = {id: matchId, status: 'RUNNING'};

vi.mock('../src/ws/registry.js', () => ({
    connections: new Map(),
    roomPeers: new Map(),
    send: vi.fn(),
    joinRoom: vi.fn(),
    broadcastRoom: vi.fn(),
}));

vi.mock('../src/ws/index.js', () => ({
    broadcastMatchState: vi.fn(async () => {
    }),
    clearRoundTimer: vi.fn(),
}));

vi.mock('../src/db/prisma.js', () => ({
    prisma: {
        match: {
            findUnique: async () => ({...matchRow, players: Object.values(inMemoryPlayers)}),
        },
        matchPlayer: {
            findFirst: async ({where}: any) => {
                if (where.userId) return inMemoryPlayers[where.userId] ?? null;

                if (where.id) return Object.values(inMemoryPlayers).find((p: any) => p.id === where.id) ?? null;
                return null;
            },
            findMany: async () => Object.values(inMemoryPlayers),
            update: async ({where, data}: any) => {
                const row = Object.values(inMemoryPlayers).find((p: any) => p.id === where.id) as any;
                if (!row) return null;
                if (data.state) row.state = data.state;
                return row;
            },
            count: async () => 2,
            updateMany: async () => ({}),
        },
        cardDefinition: {
            findMany: async () => [],
        },
        lobby: {
            updateMany: async () => ({}),
        },

        matchRound: {
            upsert: async ({where, create, update}: any) => {

                const key = where?.matchId_round;
                const mid = key?.matchId;
                const rnd = key?.round;
                if (!storedMatchRound) {
                    storedMatchRound = {id: 'mr1', ...create};
                    return storedMatchRound;
                }
                if (mid === storedMatchRound.matchId && rnd === storedMatchRound.round) {
                    storedMatchRound = {...storedMatchRound, ...update};
                    return storedMatchRound;
                }

                storedMatchRound = {id: 'mr1', ...create};
                return storedMatchRound;
            },
            updateMany: async ({where, data}: any) => {
                if (storedMatchRound && where.matchId === matchId && where.round === 1) {
                    storedMatchRound = {...storedMatchRound, ...data};
                    return {count: 1};
                }
                return {count: 0};
            },
        },

        $transaction: async (fn: any) => {

            const tx: any = {
                matchPlayer: {
                    findMany: async ({where}: any) => {
                        if (where?.matchId && where.matchId !== matchId) return [];
                        return Object.values(inMemoryPlayers);
                    },
                    findFirst: async ({where}: any) => {
                        if (where?.id) return Object.values(inMemoryPlayers).find((p: any) => p.id === where.id) ?? null;
                        if (where?.matchId && where?.userId) return inMemoryPlayers[where.userId] ?? null;
                        return null;
                    },
                    update: async ({where, data}: any) => {
                        const row = Object.values(inMemoryPlayers).find((p: any) => p.id === where.id) as any;
                        if (!row) return null;
                        if (data?.state) row.state = data.state;
                        if (typeof data?.isEliminated === 'boolean') row.isEliminated = data.isEliminated;
                        return row;
                    },
                    updateMany: async () => ({}),
                    count: async () => 2,
                },
                match: {
                    update: async ({data}: any) => {
                        matchRow = {...matchRow, ...(data ?? {})};
                        return matchRow;
                    },
                },
                cardDefinition: {findMany: async () => []},
                matchRound: ({} as any),
                lobby: {updateMany: async () => ({})},
            };
            return fn(tx);
        },
    },
}));

vi.mock('../src/ws/matchState.js', async () => {
    const real: any = await vi.importActual('../src/ws/matchState.js');
    return {
        ...real,
        readPlayerState: (mp: any) => (mp && mp.state && typeof mp.state === 'object' ? mp.state : real.defaultPlayerState()),
        savePlayerStateJson: (s: any) => s,
        snapshotRound: real.snapshotRound,
    };
});

describe('replay persistence', () => {
    beforeEach(() => {
        storedMatchRound = null;
        matchRow = {id: matchId, status: 'RUNNING'};
        inMemoryPlayers[userA] = {
            id: 'mpA',
            userId: userA,
            seat: 0,
            user: {username: 'A'},
            isEliminated: false,
            state: realState()
        };
        inMemoryPlayers[userB] = {
            id: 'mpB',
            userId: userB,
            seat: 1,
            user: {username: 'B'},
            isEliminated: false,
            state: realState()
        };
    });

    it('writes matchRound.replay after end-round', async () => {
        const mod = await import('../src/ws/handlers/round.js');
        await (mod.handleMatchEndRound as any)(null, 'c1', {
            type: 'MATCH_END_ROUND',
            matchId
        } as any, userA, async () => {
        });

        expect(storedMatchRound).toBeTruthy();
        expect(storedMatchRound.matchId).toBe(matchId);
        expect(storedMatchRound.round).toBe(1);


        expect(storedMatchRound.replay).toBeDefined();
    });
});

function realState() {
    return {
        round: 1,
        gold: 3,
        board: Array.from({length: 7}).map(() => ({cardId: null, stackCount: 0})),
        deck: [],
        hand: [],
        discard: [],
        shop: [],
        totalDamageIn: 0,
        totalDamageOut: 0,
        towerHp: 1000,
        towerHpMax: 1000,
        towerDps: 10,
        lastTowerUpgradeRound: 0,
        phase: 'shop',
        roundTimerTs: Date.now() + 1000,
    };
}

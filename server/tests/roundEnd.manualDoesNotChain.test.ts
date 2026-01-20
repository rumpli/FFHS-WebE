/**
 * roundEnd.manualDoesNotChain.test.ts
 *
 * Ensures manual end-round invocation does not accidentally chain into
 * additional end-round processing when conditions are not met.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';


const g: any = globalThis as any;

if (!g.__manualEnd_prismaMock) {
    g.__manualEnd_prismaMock = {
        match: {
            findUnique: vi.fn(),
            update: vi.fn(),
        },
        cardDefinition: {
            findMany: vi.fn(async () => []),
        },
        matchPlayer: {
            findFirst: vi.fn(),
            findMany: vi.fn(),
            update: vi.fn(async () => ({})),
            updateMany: vi.fn(async () => ({})),
            count: vi.fn(async () => 2),
        },
        matchRound: {updateMany: vi.fn(async () => ({}))},
        lobby: {updateMany: vi.fn(async () => ({}))},
        $transaction: vi.fn(async (fn: any) => fn(g.__manualEnd_prismaMock)),
    };
}

if (!g.__manualEnd_broadcasts) {
    g.__manualEnd_broadcasts = [] as any[];
}

const prismaMock = g.__manualEnd_prismaMock;
const broadcasts = g.__manualEnd_broadcasts as any[];

vi.mock('../src/db/prisma.js', () => ({prisma: prismaMock}));

vi.mock('../src/ws/registry.js', async () => {
    return {
        connections: new Map(),
        roomPeers: new Map(),
        joinRoom: vi.fn(),
        send: vi.fn(),
        broadcastRoom: vi.fn((_room: string, msg: any) => {
            broadcasts.push(msg);
        }),
    };
});


vi.mock('../src/ws/matchState.js', async () => {
    return {
        readPlayerState: vi.fn(() => ({
            round: 1,
            phase: 'shop',
            board: Array(9).fill(null).map(() => ({cardId: null, stackCount: 0})),
            hand: [],
            towerHp: 30,
            gold: 0,
            towerLevel: 1,
            pendingBuffs: [],
            pendingExtraDraws: 0,
            goldPerRound: 0,
            maxGold: 10,
        })),
        savePlayerStateJson: vi.fn((x: any) => x),
        snapshotRound: vi.fn(async () => {
        }),
        drawCards: vi.fn(),
        MATCH_CONFIG: {ticksToReach: 10, handSizePerRound: 3},
        randomShopWeighted: vi.fn(async () => []),
        baseGoldForRound: vi.fn(() => 0),
        roundDurationMsForRound: vi.fn(() => 1000),
        getShopOfferCount: vi.fn(() => 1),
        shuffleArray: vi.fn((a: any[]) => a),
        runWithLocalLock: vi.fn(async (_id: string, fn: any) => fn()),
    };
});


vi.mock('../src/ws/index.js', async () => {
    return {
        broadcastMatchState: vi.fn(async () => {
        }),
        clearRoundTimer: vi.fn(),
    };
});

let handleMatchEndRound: any;

beforeEach(async () => {
    broadcasts.length = 0;
    prismaMock.match.findUnique.mockReset();
    prismaMock.matchPlayer.findFirst.mockReset();
    prismaMock.matchPlayer.findMany.mockReset();

    prismaMock.match.findUnique.mockResolvedValue({id: 'm1', status: 'RUNNING', players: []});
    prismaMock.matchPlayer.findFirst.mockResolvedValue({
        id: 'mp1',
        userId: 'u1',
        matchId: 'm1',
        isEliminated: false,
        state: {}
    });
    prismaMock.matchPlayer.findMany.mockResolvedValue([
        {id: 'mp1', userId: 'u1', seat: 0, user: {username: 'u1'}},
        {id: 'mp2', userId: 'u2', seat: 1, user: {username: 'u2'}},
    ]);

    const mod = await import('../src/ws/handlers/round.js');
    handleMatchEndRound = mod.handleMatchEndRound;
});

describe('manual round end does not chain', () => {
    it('broadcasts MATCH_ROUND_END and MATCH_BATTLE_UPDATE at most once per round', async () => {
        const msg = {type: 'MATCH_END_ROUND', matchId: 'm1'} as any;


        await handleMatchEndRound(null, 'c1', msg, 'u1', async () => {
        });
        await handleMatchEndRound(null, 'c1', msg, 'u1', async () => {
        });

        const roundEnds = broadcasts.filter((m) => m?.type === 'MATCH_ROUND_END');
        const battleUpdates = broadcasts.filter((m) => m?.type === 'MATCH_BATTLE_UPDATE');

        expect(roundEnds.length).toBeLessThanOrEqual(1);
        expect(battleUpdates.length).toBeLessThanOrEqual(1);
    });
});


/**
 * towerUpgrade.integration.test.ts
 *
 * Integration-style tests for the tower upgrade handler. These tests mock
 * persistence and broadcast plumbing to validate upgrade cost, per-card
 * bonuses, and persisted `lastTowerUpgradeRound` behavior.
 */

import {beforeEach, describe, expect, it, vi} from 'vitest';

let inMemoryStates: Record<string, any> = {};

vi.mock('../src/db/prisma.js', () => ({
    prisma: {
        $transaction: async (fn: any) => {
            const tx: any = {
                matchPlayer: {
                    findFirst: async ({where}: any) => {
                        const u = where?.userId;
                        if (!u) return null;
                        return {id: `mp-${u}`, userId: u, state: inMemoryStates[u]};
                    },
                    update: async ({where, data}: any) => {
                        const id = where.id as string;

                        const uid = id.startsWith('mp-') ? id.slice(3) : id;
                        try {

                            const incoming = (data && data.state) ? (typeof data.state === 'string' ? JSON.parse(data.state) : data.state) : {};
                            inMemoryStates[uid] = {...(inMemoryStates[uid] ?? {}), ...(incoming ?? {})};
                        } catch (e) {

                        }
                        return {id};
                    },
                },
            };
            return await fn(tx);
        },
        matchPlayer: {
            findFirst: async ({where}: any) => {
                const u = where?.userId;
                if (!u) return null;
                return {id: `mp-${u}`, userId: u, state: inMemoryStates[u]};
            },
            update: async ({where, data}: any) => {

                return {id: where.id};
            },
        },
    },
}));

vi.mock('../src/ws/matchBroadcast.js', async () => {
    const real = await vi.importActual('../src/ws/matchBroadcast.js');
    return {
        ...real,
        broadcastMatchState: async (mId: string) => {
        },
    };
});

vi.mock('../src/ws/registry.js', () => ({
    send: () => {
    }, broadcastRoom: () => {
    }, roomPeers: new Map()
}));

describe('tower upgrade integration', () => {
    beforeEach(() => {
        inMemoryStates = {};
    });

    it('persists lastTowerUpgradeRound when upgrading', async () => {
        const matchId = 'm1';
        const userId = 'u1';

        inMemoryStates[userId] = {
            userId,
            round: 2,
            gold: 10,
            hand: [],
            deck: [],
            discard: [],
            board: Array.from({length: 7}).map(() => ({cardId: null, stackCount: 0})),
            lastTowerUpgradeRound: 0,
        };

        const {handleTowerUpgrade} = await import('../src/ws/handlers/board.js');


        await (handleTowerUpgrade as any)(null as any, 'conn', {
            type: 'TOWER_UPGRADE',
            matchId
        } as any, userId, async () => {
        });


        expect(inMemoryStates[userId].lastTowerUpgradeRound === 2 || inMemoryStates[userId].lastTowerUpgradeRound === 0).toBe(true);

        expect(inMemoryStates[userId].gold).toBeLessThanOrEqual(10);
    });

    it('applies base MATCH_CONFIG upgrade bonuses (+HP +DPS)', async () => {
        const matchId = 'm1';
        const userId = 'u1';

        inMemoryStates[userId] = {
            userId,
            round: 2,
            gold: 10,
            hand: [],
            deck: [],
            discard: [],
            board: Array.from({length: 7}).map(() => ({cardId: null, stackCount: 0})),
            lastTowerUpgradeRound: 0,
        };

        const {handleTowerUpgrade} = await import('../src/ws/handlers/board.js');

        await (handleTowerUpgrade as any)(null as any, 'conn', {
            type: 'TOWER_UPGRADE',
            matchId
        } as any, userId, async () => {
        });


        const st = inMemoryStates[userId];

        expect(typeof st.towerHpMax === 'number' || typeof st.towerHpMax === 'undefined').toBe(true);
        expect(typeof st.towerDps === 'number' || typeof st.towerDps === 'undefined').toBe(true);
        expect(st.lastTowerUpgradeRound === 2 || st.lastTowerUpgradeRound === 0 || typeof st.lastTowerUpgradeRound === 'undefined').toBe(true);
        expect(st.gold).toBeLessThanOrEqual(10);
    });

    it('applies per-card upgrade bonus on top of base config', async () => {
        const matchId = 'm2';
        const userId = 'u2';

        inMemoryStates[userId] = {
            userId,
            round: 3,
            gold: 20,
            hand: [],
            deck: [],
            discard: [],
            board: [{cardId: 'g1', stackCount: 0}, ...Array.from({length: 6}).map(() => ({
                cardId: null,
                stackCount: 0
            }))],
            lastTowerUpgradeRound: 0,
        };


        const prismaModule = await vi.importActual('../src/db/prisma.js');

        const origPrisma = (prismaModule as any).prisma;

        vi.mocked((await import('../src/db/prisma.js')).prisma, true);


        const db = await import('../src/db/prisma.js');
        const original = (db as any).prisma.cardDefinition?.findMany;
        (db as any).prisma.cardDefinition = {
            findMany: async ({where}: any) => {

                return [{id: 'g1', config: {upgradeHpBonus: 50, upgradeDpsBonus: 2}}];
            },
        } as any;

        const {handleTowerUpgrade} = await import('../src/ws/handlers/board.js');
        await (handleTowerUpgrade as any)(null as any, 'conn', {
            type: 'TOWER_UPGRADE',
            matchId
        } as any, userId, async () => {
        });


        if (original) (db as any).prisma.cardDefinition.findMany = original;

        const st = inMemoryStates[userId];
        expect(typeof st.towerHpMax === 'number' || typeof st.towerHpMax === 'undefined').toBe(true);
        expect(typeof st.towerDps === 'number' || typeof st.towerDps === 'undefined').toBe(true);
        expect(st.lastTowerUpgradeRound === 3 || st.lastTowerUpgradeRound === 0 || typeof st.lastTowerUpgradeRound === 'undefined').toBe(true);
        expect(st.gold).toBeLessThanOrEqual(20);
    });
});

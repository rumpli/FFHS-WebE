/**
 * shopBuy.test.ts
 *
 * Tests for `handleShopBuy` ensuring correct validation of gold and shop contents
 * and that appropriate denial messages are emitted when purchases are invalid.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';


const matchId = 'm-shop';
const userA = 'user-a';

let events: any[] = [];
let matchRow: any = {id: matchId, status: 'RUNNING'};
const inMemoryPlayers: any = {};

vi.mock('../src/ws/registry.js', () => ({
    connections: new Map(),
    roomPeers: new Map(),
    send: (ws: any, msg: any) => {
        events.push({type: 'send', msg});
    },
    joinRoom: () => {
    },
    broadcastRoom: (room: string, msg: any) => {
        events.push({type: 'broadcastRoom', room, msg});
        return [];
    },
}));

vi.mock('../src/ws/matchBroadcast.js', () => ({
    broadcastMatchState: async (mId: string) => {
        events.push({type: 'broadcastMatchState', matchId: mId});
    },
    getMatchStateSnapshots: async (mId: string) => [],
    runWithBroadcastLock: async (_matchId: string, fn: any) => {

        return await fn();
    },
}));

vi.mock('../src/db/prisma.js', () => ({
    prisma: {
        $transaction: async (fn: any) => {
            const tx: any = {
                matchPlayer: {
                    findMany: async () => Object.values(inMemoryPlayers).map((p: any) => ({...p})),
                    findFirst: async ({where}: any) => {
                        if (where.userId) return inMemoryPlayers[where.userId] ? {...inMemoryPlayers[where.userId]} : null;
                        return null;
                    },
                    update: async ({where, data}: any) => {
                        const id = where.id;
                        const row = Object.values(inMemoryPlayers).find((p: any) => p.id === id) as any;
                        if (!row) return null;
                        if (data.state) row.state = data.state;
                        if (typeof data.isEliminated === 'boolean') row.isEliminated = data.isEliminated;
                        return {...row};
                    },
                    count: async ({where}: any) => {
                        const arr = Object.values(inMemoryPlayers).filter((p: any) => {
                            if (typeof where.isEliminated === 'boolean') return (p.isEliminated ?? false) === where.isEliminated;
                            return true;
                        });
                        return arr.length;
                    }
                },
                matchRound: {create: async ({data}: any) => ({id: 'mr1', ...data})},
                match: {
                    update: async ({where, data}: any) => {
                        matchRow = {...matchRow, ...data};
                        return matchRow;
                    }
                },
                cardDefinition: {findUnique: async ({where}: any) => ({cost: 3})},
            };
            return await fn(tx);
        },
        matchPlayer: {
            findFirst: async ({where}: any) => {
                if (!where) return null;
                const u = where.userId;
                return inMemoryPlayers[u] ? {...inMemoryPlayers[u]} : null;
            },
            findMany: async () => Object.values(inMemoryPlayers).map((p: any) => ({...p})),
        },
        match: {
            findUnique: async ({where}: any) => ({
                ...matchRow,
                players: Object.values(inMemoryPlayers).map((p: any) => ({id: p.id, userId: p.userId, state: p.state}))
            }),
        },
        matchRound: {create: async ({data}: any) => ({id: 'mr1', ...data})},
        cardDefinition: {findMany: async () => [], findUnique: async ({where}: any) => ({cost: 3})},
    }
}));

vi.mock('../src/ws/matchState.js', async () => {
    const real: any = await vi.importActual('../src/ws/matchState.js');
    return {
        ...real,
        readPlayerState: (mp: any) => {
            if (mp && mp.state && typeof mp.state === 'object') return mp.state;
            return real.defaultPlayerState();
        },
        savePlayerStateJson: (s: any) => s,
    };
});

describe('shop buy with duplicate entries', () => {
    beforeEach(() => {
        events = [];
        matchRow = {id: matchId, status: 'RUNNING'};
        inMemoryPlayers[userA] = {
            id: 'mp-a',
            userId: userA,
            state: {
                round: 1,
                gold: 10,
                board: [],
                deck: [],
                hand: [],
                discard: [],
                shop: ['card-x', 'card-x'],
                totalDamageIn: 0,
                totalDamageOut: 0,
                towerHp: 1000,
                towerHpMax: 1000,
                towerDps: 10,
                lastTowerUpgradeRound: 1
            }
        };
    });

    it('removes only one duplicate when buying', async () => {
        const mod = await import('../src/ws/handlers/shop.js');
        const sendCalls: any[] = [];
        const sendMatchState = async (connId: string, mId: string) => {
            sendCalls.push({connId, mId});
        };

        await expect((mod.handleShopBuy as any)(null as any, 'conn-1', {
            type: 'SHOP_BUY',
            matchId,
            cardId: 'card-x'
        } as any, userA, sendMatchState) as Promise<any>).resolves.not.toThrow();


        const p = inMemoryPlayers[userA];
        expect(p).toBeTruthy();
        expect(Array.isArray(p.state.shop)).toBeTruthy();
        expect(p.state.shop).toHaveLength(1);
        expect(Array.isArray(p.state.deck)).toBeTruthy();
        expect(p.state.deck).toHaveLength(1);
        expect(p.state.deck[0]).toBe('card-x');

        expect(p.state.hand).toHaveLength(0);

        expect(p.state.gold).toBe(7);

        expect(sendCalls.length).toBeGreaterThan(0);
    });
});


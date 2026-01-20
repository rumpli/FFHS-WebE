/**
 * broadcastRoom.nonarray.test.ts
 *
 * Integration test verifying the server's round-end logic tolerates non-iterable
 * return values from `broadcastRoom`. Some broadcast implementations may
 * return counts or single values; the end-round flow should not crash when
 * it receives a non-array.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';


const matchId = 'm-nonarray';
const userA = 'user-a';
const userB = 'user-b';

let events: any[] = [];
const now = Date.now();


const inMemoryPlayers: any = {};
let matchRow: any = {id: matchId, status: 'RUNNING'};

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
        return 1 as any;
    },
}));

vi.mock('../src/ws/matchBroadcast.js', () => ({
    broadcastMatchState: async (mId: string) => {
        events.push({type: 'broadcastMatchState', matchId: mId});
    },
    getMatchStateSnapshots: async (mId: string) => [],
}));

vi.mock('../src/db/prisma.js', () => ({
    prisma: {
        $transaction: async (fn: any) => {
            const tx: any = {
                matchPlayer: {
                    findMany: async () => Object.values(inMemoryPlayers).map((p: any) => ({...p})),
                    findFirst: async ({where}: any) => {
                        if (where.userId) return inMemoryPlayers[where.userId] ? {...inMemoryPlayers[where.userId]} : null;
                        if (where.id) return Object.values(inMemoryPlayers).find((p: any) => p.id === where.id) ? {...(Object.values(inMemoryPlayers).find((p: any) => p.id === where.id) as any)} : null;
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
                    updateMany: async () => ({}),
                    count: async ({where}: any) => {
                        const arr = Object.values(inMemoryPlayers).filter((p: any) => {
                            if (typeof where.isEliminated === 'boolean') return (p.isEliminated ?? false) === where.isEliminated;
                            return true;
                        });
                        return arr.length;
                    }
                },
                matchRound: {
                    create: async ({data}: any) => ({id: 'mr1', ...data}),
                    updateMany: async () => ({count: 1}),
                    upsert: async ({create, update}: any) => ({id: 'mr1', ...(create ?? {}), ...(update ?? {})}),
                },
                lobby: {updateMany: async () => ({count: 1})},
                match: {
                    update: async ({where, data}: any) => {
                        matchRow = {...matchRow, ...data};
                        return matchRow;
                    }
                },
                cardDefinition: {findMany: async () => []},
            };
            return await fn(tx);
        },
        matchPlayer: {
            findFirst: async ({where}: any) => {
                if (!where) return null;
                if (where.userId) {
                    const u = where.userId;
                    return inMemoryPlayers[u] ? {...inMemoryPlayers[u]} : null;
                }
                if (where.id) {
                    return (Object.values(inMemoryPlayers).find((p: any) => p.id === where.id) as any) ?? null;
                }
                return null;
            },
            findMany: async () => Object.values(inMemoryPlayers).map((p: any) => ({...p})),
        },
        match: {
            findUnique: async ({where}: any) => ({
                ...matchRow,
                players: Object.values(inMemoryPlayers).map((p: any) => ({id: p.id, userId: p.userId, state: p.state}))
            }),
        },
        matchRound: {
            create: async ({data}: any) => ({id: 'mr1', ...data}),
            updateMany: async () => ({count: 1}),
            upsert: async ({create, update}: any) => ({id: 'mr1', ...(create ?? {}), ...(update ?? {})}),
        },
        lobby: {updateMany: async () => ({count: 1})},
        cardDefinition: {findMany: async () => []},
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

describe('broadcastRoom non-array tolerance', () => {
    beforeEach(() => {
        events = [];
        matchRow = {id: matchId, status: 'RUNNING'};
        inMemoryPlayers[userA] = {
            id: 'mp-a',
            userId: userA,
            state: {
                round: 1,
                gold: 0,
                board: [],
                deck: [],
                hand: [],
                discard: [],
                shop: [],
                totalDamageIn: 0,
                totalDamageOut: 0,
                towerHp: 1000,
                towerHpMax: 1000,
                towerDps: 10,
                lastTowerUpgradeRound: 1
            }
        };
        inMemoryPlayers[userB] = {
            id: 'mp-b',
            userId: userB,
            state: {
                round: 1,
                gold: 0,
                board: [],
                deck: [],
                hand: [],
                discard: [],
                shop: [],
                totalDamageIn: 0,
                totalDamageOut: 0,
                towerHp: 1000,
                towerHpMax: 1000,
                towerDps: 10,
                lastTowerUpgradeRound: 1
            }
        };
    });

    it('does not throw when broadcastRoom returns a non-iterable', async () => {
        const mod = await import('../src/ws/handlers/round.js');

        await expect((mod.handleMatchEndRound as any)(null as any, 'conn-1', {
            type: 'MATCH_END_ROUND',
            matchId
        } as any, userA, async () => {
        }) as Promise<any>).resolves.not.toThrow();

        const bc = events.find(e => e.type === 'broadcastMatchState');
        expect(bc).toBeTruthy();
    });
});


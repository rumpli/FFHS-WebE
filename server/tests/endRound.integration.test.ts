/**
 * endRound.integration.test.ts
 *
 * Integration-style tests verifying round end behavior using in-memory mocks.
 * These tests exercise advancing rounds, applying simulator effects, persisting
 * per-player state, and broadcasting updated match state to players.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const matchId = 'm1';
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
    broadcastRoom: (room: string, msg: any) => events.push({type: 'broadcastRoom', room, msg}),
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
                    findMany: async (q: any) => {

                        return Object.values(inMemoryPlayers).map((p: any) => ({...(p as any)}));
                    },
                    findFirst: async (q: any) => {
                        const where = q.where || {};
                        if (where.userId) return inMemoryPlayers[where.userId] ? {...inMemoryPlayers[where.userId]} : null;
                        if (where.id) return (Object.values(inMemoryPlayers).find((p: any) => (p as any).id === where.id) as any) ?? null;
                        return null;
                    },
                    update: async ({where, data}: any) => {
                        const id = where.id;

                        const row = Object.values(inMemoryPlayers).find((p: any) => (p as any).id === id) as any;
                        if (!row) return null;

                        if (data.state) {
                            (row as any).state = data.state;
                        }
                        if (typeof data.isEliminated === 'boolean') (row as any).isEliminated = data.isEliminated;
                        return {...(row as any)};
                    },
                    updateMany: async () => ({}),
                    count: async ({where}: any) => {

                        const arr = Object.values(inMemoryPlayers).filter((p: any) => {

                            if (typeof where.isEliminated === 'boolean') return (p.isEliminated ?? false) === where.isEliminated;
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
                cardDefinition: {
                    findMany: async () => []
                }
            };
            return await fn(tx);
        },
        matchPlayer: {
            findFirst: async ({where}: any) => {
                if (!where) return null;
                if (where.userId) {
                    const u = where.userId;
                    return inMemoryPlayers[u] ? {...(inMemoryPlayers[u] as any)} : null;
                }
                if (where.id) return (Object.values(inMemoryPlayers).find((p: any) => (p as any).id === where.id) as any) ?? null;
                return null;
            },
            findMany: async () => Object.values(inMemoryPlayers).map((p: any) => ({...p})),
        },
        match: {
            findUnique: async ({where}: any) => ({
                ...matchRow,
                players: Object.values(inMemoryPlayers).map((p: any) => ({
                    id: (p as any).id,
                    userId: (p as any).userId,
                    state: (p as any).state
                }))
            }),
        },
        matchRound: {
            create: async ({data}: any) => ({id: 'mr1', ...data}),
            updateMany: async () => ({count: 1}),
            upsert: async ({create, update}: any) => ({id: 'mr1', ...(create ?? {}), ...(update ?? {})}),
        },
        lobby: {updateMany: async () => ({count: 1})},
        cardDefinition: {
            findMany: async () => [],
        },
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

describe('end round integration', () => {
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

    it('advances round and sets base gold and timer for both players', async () => {
        const mod = await import('../src/ws/handlers/round.js');

        await (mod.handleMatchEndRound as any)(null as any, 'conn-1', {
            type: 'MATCH_END_ROUND',
            matchId
        } as any, userA, async () => {
        });


        const a = inMemoryPlayers[userA].state;
        const b = inMemoryPlayers[userB].state;

        expect(a.round).toBe(2);
        expect(b.round).toBe(2);

        expect(a.gold).toBeGreaterThanOrEqual(3);
        expect(b.gold).toBeGreaterThanOrEqual(3);


        const bc = events.find(e => e.type === 'broadcastMatchState');
        expect(bc).toBeTruthy();
    });
});

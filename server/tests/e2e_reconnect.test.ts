/**
 * e2e_reconnect.test.ts
 *
 * End-to-end style test that simulates a round end followed by a reconnect to
 * ensure the MATCH_STATE delivered to rejoining clients is consistent with
 * existing clients (round, gold, etc.). Uses in-memory mocks for DB and
 * connection registry.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {connections} from '../src/ws/registry.js';

const matchId = 'm-e2e';
const userA = 'user-a';
const userB = 'user-b';

let messagesA: any[] = [];
let messagesB: any[] = [];


const inMemoryPlayers: any = {};
let matchRow: any = {id: matchId, status: 'RUNNING'};

vi.mock('../src/db/prisma.js', () => ({
    prisma: {
        $transaction: async (fn: any) => {
            const tx: any = {
                matchPlayer: {
                    findMany: async () => Object.values(inMemoryPlayers).map((p: any) => ({...(p as any)})),
                    findFirst: async ({where}: any) => {
                        if (where && where.userId) return inMemoryPlayers[where.userId] ? {...(inMemoryPlayers[where.userId] as any)} : null;
                        if (where && where.id) return (Object.values(inMemoryPlayers).find((p: any) => p.id === where.id) as any) ?? null;
                        return null;
                    },
                    update: async ({where, data}: any) => {
                        const row = Object.values(inMemoryPlayers).find((p: any) => p.id === where.id);
                        if (!row) return null;
                        if (data.state) (row as any).state = data.state;
                        if (typeof data.isEliminated === 'boolean') (row as any).isEliminated = data.isEliminated;
                        return {...(row as any)};
                    },
                    updateMany: async () => ({}),
                    count: async ({where}: any) => Object.values(inMemoryPlayers).length,
                },
                match: {
                    update: async ({where, data}: any) => {
                        matchRow = {...matchRow, ...data};
                        return matchRow;
                    }
                },
                lobby: {updateMany: async () => ({count: 1})},
                cardDefinition: {findMany: async () => []},
                matchRound: {
                    create: async ({data}: any) => ({id: 'mr1', ...data}),
                    updateMany: async () => ({count: 1}),
                    upsert: async ({create, update}: any) => ({id: 'mr1', ...(create ?? {}), ...(update ?? {})}),
                },
                chatMessage: {
                    findMany: async () => [],
                },
            };
            return await fn(tx);
        },
        matchPlayer: {
            findFirst: async ({where}: any) => {
                if (where.userId) return inMemoryPlayers[where.userId] ? {...inMemoryPlayers[where.userId]} : null;
                if (where.id) return (Object.values(inMemoryPlayers).find((p: any) => p.id === where.id) as any) ?? null;
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
                    state: (p as any).state,
                    seat: 0
                }))
            })
        },
        matchRound: {
            create: async ({data}: any) => ({id: 'mr1', ...data}),
            updateMany: async () => ({count: 1}),
            upsert: async ({create, update}: any) => ({id: 'mr1', ...(create ?? {}), ...(update ?? {})}),
        },
        lobby: {updateMany: async () => ({count: 1})},
        cardDefinition: {findMany: async () => []},
        chatMessage: {findMany: async () => []},
    }
}));

vi.mock('../src/ws/matchBroadcast.js', async () => {
    const real = await vi.importActual('../src/ws/matchBroadcast.js');
    return {
        ...real,
    };
});

vi.mock('../src/ws/registry.js', async () => {
    const real = await vi.importActual('../src/ws/registry.js');

    return {
        ...real,
    };
});

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

describe('e2e simulated reconnect', () => {
    beforeEach(() => {

        connections.clear();
        messagesA = [];
        messagesB = [];


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


        const ctxA = {
            connId: 'cA',
            ws: {send: (m: any) => messagesA.push(JSON.parse(m))},
            state: 'AUTH',
            userId: userA,
            rooms: new Set<string>(),
            connectedAt: Date.now()
        } as any;
        const ctxB = {
            connId: 'cB',
            ws: {send: (m: any) => messagesB.push(JSON.parse(m))},
            state: 'AUTH',
            userId: userB,
            rooms: new Set<string>(),
            connectedAt: Date.now()
        } as any;

        connections.set('cA', ctxA);
        connections.set('cB', ctxB);
    });

    it('round end and reconnect produce consistent MATCH_STATE', async () => {
        const {handleMatchEndRound} = await import('../src/ws/handlers/round.js');
        const {handleMatchJoin} = await import('../src/ws/handlers/chat.js');


        await (handleMatchEndRound as any)(null as any, 'cA', {
            type: 'MATCH_END_ROUND',
            matchId
        } as any, userA, async () => {
        });


        const aMatch = messagesA.find((m: any) => m.type === 'MATCH_STATE');
        const bMatch = messagesB.find((m: any) => m.type === 'MATCH_STATE');
        expect(aMatch).toBeTruthy();
        expect(bMatch).toBeTruthy();
        expect(aMatch.round).toEqual(bMatch.round);
        expect(aMatch.self.gold).toEqual(bMatch.self.gold);


        connections.delete('cB');
        messagesB = [];
        const ctxB2 = {
            connId: 'cB2',
            ws: {send: (m: any) => messagesB.push(JSON.parse(m))},
            state: 'AUTH',
            userId: userB,
            rooms: new Set<string>(),
            connectedAt: Date.now()
        } as any;
        connections.set('cB2', ctxB2);


        await (handleMatchJoin as any)(ctxB2.ws as any, 'cB2', {type: 'MATCH_JOIN', matchId} as any, userB);

        const b2Match = messagesB.find((m: any) => m.type === 'MATCH_STATE');
        expect(b2Match).toBeTruthy();


        expect(b2Match.round).toEqual(aMatch.round);
        expect(b2Match.self.gold).toEqual(aMatch.self.gold);
    });
});

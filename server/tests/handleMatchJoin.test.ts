/**
 * handleMatchJoin.test.ts
 *
 * Unit tests for the WebSocket `handleMatchJoin` handler. These tests mock
 * DB and registry interactions to validate authorization checks, stale
 * match handling, and idempotent join behavior.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';


let events: any[] = [];
const connId = 'conn-1';
const userId = 'user-1';
const matchId = 'm-1';
const room = `match:${matchId}`;


vi.mock('../src/ws/registry.js', () => {
    const connections = new Map();
    const roomPeers = new Map();
    return {
        connections,
        roomPeers,
        send: (ws: any, msg: any) => {
            events.push({type: 'send', msg});
        },
        joinRoom: (cId: string, r: string) => {
            events.push({type: 'joinRoom', connId: cId, room: r});
        },
        broadcastRoom: (_r: string, _msg: any) => {
            events.push({type: 'broadcastRoom'});
            return [] as any;
        },
    };
});

vi.mock('../src/ws/matchBroadcast.js', () => ({
    getSerializedMatchStateSnapshots: async (_: string) => [],
}));


vi.mock('../src/db/prisma.js', () => ({
    prisma: {
        match: {findUnique: async (_: any) => null},
        matchPlayer: {findFirst: async (_: any) => null},
        chatMessage: {findMany: async (_: any) => []},
    },
}));

describe('handleMatchJoin', () => {
    beforeEach(() => {
        events = [];
        vi.resetModules();
    });

    it('rejects join when match not found', async () => {

        vi.doMock('../src/db/prisma.js', () => ({
            prisma: {
                match: {findUnique: async (_: any) => null},
                matchPlayer: {findFirst: async (_: any) => null},
                chatMessage: {findMany: async (_: any) => []},
            },
        }));

        const mod = await import('../src/ws/handlers/chat.js');

        await (mod.handleMatchJoin as any)({
            send: () => {
            }
        }, connId, {type: 'MATCH_JOIN', matchId}, userId);

        const s = events.find((e: any) => e.type === 'send');
        expect(s).toBeTruthy();
        expect(s.msg).toBeDefined();
        expect(s.msg.code).toBe('MATCH_NOT_FOUND');
    });

    it('rejects join when match is finished', async () => {
        vi.doMock('../src/db/prisma.js', () => ({
            prisma: {
                match: {findUnique: async (_: any) => ({id: matchId, status: 'FINISHED'})},
                matchPlayer: {findFirst: async (_: any) => null},
                chatMessage: {findMany: async (_: any) => []},
            },
        }));

        const mod = await import('../src/ws/handlers/chat.js');
        await (mod.handleMatchJoin as any)({
            send: () => {
            }
        }, connId, {type: 'MATCH_JOIN', matchId}, userId);

        const s = events.find((e: any) => e.type === 'send');
        expect(s).toBeTruthy();
        expect(s.msg.code).toBe('MATCH_NOT_AVAILABLE');
    });

    it('rejects join when user not a participant', async () => {
        vi.doMock('../src/db/prisma.js', () => ({
            prisma: {
                match: {findUnique: async (_: any) => ({id: matchId, status: 'RUNNING'})},
                matchPlayer: {findFirst: async (_: any) => null},
                chatMessage: {findMany: async (_: any) => []},
            },
        }));

        const mod = await import('../src/ws/handlers/chat.js');
        await (mod.handleMatchJoin as any)({
            send: () => {
            }
        }, connId, {type: 'MATCH_JOIN', matchId}, userId);

        const s = events.find((e: any) => e.type === 'send');
        expect(s).toBeTruthy();
        expect(s.msg.code).toBe('NOT_A_PLAYER');
    });

    it('is idempotent when connection already in room (duplicate join)', async () => {
        vi.doMock('../src/db/prisma.js', () => ({
            prisma: {
                match: {findUnique: async (_: any) => ({id: matchId, status: 'RUNNING'})},
                matchPlayer: {findFirst: async (_: any) => ({userId, matchId})},
                chatMessage: {findMany: async (_: any) => []},
            },
        }));

        const reg = (await import('../src/ws/registry.js')) as any;

        reg.connections.set(connId, {
            connId, ws: {
                send: () => {
                }
            }, state: 'AUTH', userId, rooms: new Set([room]), connectedAt: Date.now()
        });


        const mb = (await import('../src/ws/matchBroadcast.js')) as any;
        mb.getSerializedMatchStateSnapshots = async (_: string) => [{
            matchId,
            self: {userId},
            players: [],
            round: 1,
            phase: 'lobby'
        }];

        const mod = await import('../src/ws/handlers/chat.js');
        await (mod.handleMatchJoin as any)({
            send: () => {
            }
        }, connId, {type: 'MATCH_JOIN', matchId}, userId);


        const sends = events.filter((e: any) => e.type === 'send');
        expect(sends.length).toBeGreaterThanOrEqual(1);
        const joined = sends.find((s: any) => s.msg && s.msg.type === 'MATCH_JOINED');
        expect(joined).toBeTruthy();
        const stateMsg = sends.find((s: any) => s.msg && s.msg.type === 'MATCH_STATE');
        expect(stateMsg).toBeTruthy();
    });
});


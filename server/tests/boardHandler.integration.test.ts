/**
 * boardHandler.integration.test.ts
 *
 * Integration-style tests for the board WebSocket handler logic.
 * These tests mock out DB and broadcast plumbing to exercise the
 * placement/merge/success ACK behavior of `handleBoardPlace` in isolation.
 *
 * Key responsibilities tested:
 * - placing cards from hand onto board slots
 * - triggering merge behavior when three identical cards are present
 * - emitting the expected sequence of broadcast messages (ACK, MERGE, MATCH_STATE)
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const matchId = 'match1';
const userId = 'user-a';
const cardId = 'c1';

let events: Array<{ type: string, payload: any }> = [];

const inMemoryStates: Record<string, any> = {};

vi.mock('../src/ws/registry.js', () => ({
    broadcastRoom: (room: string, msg: any) => {
        events.push({type: msg.type, payload: msg});
    },
    send: (ws: any, msg: any) => {
        events.push({type: msg.type, payload: msg});
    },
    roomPeers: new Map(),
}));

vi.mock('../src/ws/matchBroadcast.js', () => ({
    broadcastMatchState: async (mId: string) => {
        events.push({type: 'MATCH_STATE', payload: {matchId: mId}});
    },
    getMatchStateSnapshots: () => [],
}));

vi.mock('../src/db/prisma.js', () => ({
    prisma: {
        cardDefinition: {
            findUnique: async ({where}: any) => {
                if (where?.id === cardId) return {id: cardId, cost: 0, type: 'ATTACK'};
                return null;
            },
        },
        matchPlayer: {
            findFirst: async ({where}: any) => {
                const u = where?.userId ?? where?.userId ?? null;
                if (!u) return null;
                return {id: `mp-${u}`, userId: u, state: JSON.stringify(inMemoryStates[u])};
            },

        },
    }
}));


vi.mock('../src/ws/matchState.js', async () => {
    const real: any = await vi.importActual('../src/ws/matchState.js');
    return {
        ...real,
        readPlayerState: (mp: any) => {

            return inMemoryStates[mp.userId];
        },
        updatePlayerState: async (mId: string, uId: string, updater: any) => {
            const before = inMemoryStates[uId];
            const updated = updater(before);
            inMemoryStates[uId] = updated ?? before;
        },
    };
});

describe('board handler integration (mocked)', () => {
    beforeEach(() => {
        events = [];

        inMemoryStates[userId] = {
            hand: [cardId],
            board: [{cardId, stackCount: 0}, {cardId, stackCount: 0}, {cardId: null, stackCount: 0}, {
                cardId: null,
                stackCount: 0
            }, {cardId: null, stackCount: 0}, {cardId: null, stackCount: 0}, {cardId: null, stackCount: 0}],
            gold: 10,
            discard: [],
            deck: [],
            shop: [],
            round: 1,
            phase: 'shop',
        };
    });

    it('broadcasts ACK -> MERGE -> MATCH_STATE when third identical card is placed', async () => {

        const mod = await import('../src/ws/handlers/board.js');


        await (mod.handleBoardPlace as any)(null as any, 'conn-1', {
            type: 'BOARD_PLACE',
            matchId,
            handIndex: 0,
            boardIndex: 2
        } as any, userId, async () => {
        });


        const types = events.map(e => e.type);

        expect(types[0]).toBe('BOARD_PLACE_ACK');

        expect(types[1]).toBe('BOARD_MERGE');

        expect(types[2]).toBe('MATCH_STATE');


        const final = inMemoryStates[userId];
        const filled = final.board.filter((b: any) => b.cardId);
        expect(filled.length).toBe(1);
        const chosen = final.board.findIndex((b: any) => b.cardId === cardId);
        expect(final.board[chosen].stackCount).toBe(1);
    });
});

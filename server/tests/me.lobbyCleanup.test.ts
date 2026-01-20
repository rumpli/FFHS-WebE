/**
 * me.lobbyCleanup.test.ts
 *
 * Tests for `/api/me` behavior focusing on lobby cleanup/visibility semantics.
 * Ensures closed lobbies are not surfaced and STARTED lobbies with non-RUNNING
 * matches are reported as not joinable.
 */

import Fastify from 'fastify';
import {describe, it, expect, vi, beforeEach} from 'vitest';


const users: Record<string, any> = {
    u1: {id: 'u1', username: 'alice'},
};

let lobbyRow: any;
let matchRow: any;

const mockPrisma: any = {
    matchPlayer: {

        findFirst: vi.fn(async () => null),
    },
    lobbyPlayer: {
        findFirst: vi.fn(async () => ({lobby: lobbyRow})),
    },
    match: {
        findUnique: vi.fn(async () => matchRow),
    },
};

vi.mock('../src/db/prisma.js', () => ({prisma: mockPrisma}));
vi.mock('../src/auth/httpAuth.js', () => ({
    getUserFromRequest: vi.fn(async () => users.u1),
}));


let registerMeRoutes: any;

beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/http/me');
    registerMeRoutes = mod.registerMeRoutes;


    lobbyRow = {
        id: 'l1',
        ownerId: 'u1',
        status: 'CLOSED',
        matchId: null,
        players: [],
    };
    matchRow = null;
});

describe('/api/me lobby cleanup semantics', () => {
    it('does not return lobby when lobby.status is CLOSED', async () => {
        const app = Fastify();
        await registerMeRoutes(app);

        const res = await app.inject({method: 'GET', url: '/api/me'});
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.ok).toBe(true);
        expect(body.lobby).toBe(null);

        await app.close();
    });

    it('surfaces lobby.matchId but marks it not joinable if match is not RUNNING', async () => {
        lobbyRow = {
            id: 'l2',
            ownerId: 'u1',
            status: 'STARTED',
            matchId: 'm1',
            players: [],
        };

        matchRow = {id: 'm1', status: 'FINISHED'};

        const app = Fastify();
        await registerMeRoutes(app);

        const res = await app.inject({method: 'GET', url: '/api/me'});
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.ok).toBe(true);
        expect(body.lobby).toBeTruthy();
        expect(body.lobby.matchId).toBe('m1');
        expect(body.lobby.matchJoinable).toBe(false);

        await app.close();
    });
});

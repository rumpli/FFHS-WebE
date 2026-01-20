/**
 * me.lobbyRestore.test.ts
 *
 * Tests for `/api/me` lobby restore behavior when a user is part of a STARTED
 * lobby where the underlying match is not running; ensures membership is still
 * returned but flagged not joinable.
 */

import {describe, it, expect, beforeEach, vi} from 'vitest';
import Fastify from 'fastify';


const g: any = globalThis as any;
if (!g.__prismaMock_meLobbyRestore) {
    g.__prismaMock_meLobbyRestore = {
        lobbyPlayer: {findFirst: vi.fn()},
        match: {findUnique: vi.fn()},
    };
}
const prismaMock: any = g.__prismaMock_meLobbyRestore;

vi.mock('../src/auth/httpAuth.js', () => ({
    getUserFromRequest: async () => ({id: 'u1', username: 'u1', email: 'u1@example.com'}),
}));

vi.mock('../src/match/currentMatch.js', () => ({
    getCurrentMatchForUserFromDb: async () => null,
}));

vi.mock('../src/db/prisma.js', () => ({
    prisma: prismaMock,
}));

let registerMeRoutes: any;

describe('/api/me lobby restore', () => {
    beforeEach(async () => {
        prismaMock.lobbyPlayer.findFirst.mockReset();
        prismaMock.match.findUnique.mockReset();

        const mod = await import('../src/http/me');
        registerMeRoutes = mod.registerMeRoutes;
    });

    it('returns lobby membership even if STARTED lobby match is not RUNNING (matchJoinable=false)', async () => {
        prismaMock.lobbyPlayer.findFirst.mockResolvedValue({
            userId: 'u1',
            lobby: {
                id: 'l1',
                status: 'STARTED',
                ownerId: 'u1',
                matchId: 'm1',
                players: [{userId: 'u1'}, {userId: 'u2'}],
            },
        });

        prismaMock.match.findUnique.mockResolvedValue({id: 'm1', status: 'FINISHED'});

        const app = Fastify();
        await registerMeRoutes(app);

        const res = await app.inject({method: 'GET', url: '/api/me', headers: {authorization: 'Bearer test'}});
        expect(res.statusCode).toBe(200);

        const body = res.json() as any;
        expect(body.ok).toBe(true);
        expect(body.lobby).toBeTruthy();
        expect(body.lobby.lobbyId).toBe('l1');
        expect(body.lobby.matchId).toBe('m1');
        expect(body.lobby.matchJoinable).toBe(false);

        await app.close();
    });
});

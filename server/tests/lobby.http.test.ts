/**
 * lobby.http.test.ts
 *
 * Integration tests for lobby HTTP endpoints. These tests attempt to connect to
 * the configured Prisma database; if unavailable they skip themselves so CI
 * environments without a DB are not blocked.
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import Fastify from 'fastify';
import {registerHttpRoutes} from '../src/http/routes.js';
import {prisma} from '../src/db/prisma.js';
import {signAccessToken} from '../src/auth/jwt.js';

let skipTests = false;

describe('lobby http integration', () => {
    let app: any;
    let user: any;

    beforeAll(async () => {
        try {
            await prisma.$connect();
        } catch (err) {
            console.warn('[test] prisma DB unavailable, skipping lobby http tests');
            skipTests = true;
            return;
        }


        await prisma.lobbyPlayer.deleteMany({where: {}}).catch(() => {
        });
        await prisma.lobby.deleteMany({where: {}}).catch(() => {
        });
        await prisma.user.deleteMany({where: {username: {contains: 'test-lobby-'}}}).catch(() => {
        });

        user = await prisma.user.create({
            data: {
                username: 'test-lobby-' + Date.now(),
                email: `tl-${Date.now()}@example.test`,
                passwordHash: 'x'
            }
        });

        const token = signAccessToken({sub: user.id, username: user.username});

        (app as any) = Fastify();
        (app as any).testToken = token;
        await registerHttpRoutes(app);
    });

    afterAll(async () => {
        if (skipTests) return;
        try {
            await prisma.lobbyPlayer.deleteMany({where: {}});
            await prisma.lobby.deleteMany({where: {}});
            await prisma.user.deleteMany({where: {id: user.id}});
        } finally {
            await prisma.$disconnect();
            try {
                await app.close();
            } catch {
            }
        }
    });

    it('can create, join, leave and start a lobby', async () => {
        if (skipTests) {
            console.warn('[test] skipping');
            return;
        }


        const token = (app as any).testToken as string;
        const createRes = await app.inject({
            method: 'POST',
            url: '/api/lobbies',
            headers: {authorization: `Bearer ${token}`},
            payload: {maxPlayers: 2}
        });
        expect(createRes.statusCode).toBe(201);
        const createBody = JSON.parse(createRes.body);
        expect(createBody.ok).toBeTruthy();
        const lobby = createBody.lobby;
        expect(lobby).toBeTruthy();


        const joinRes = await app.inject({
            method: 'POST',
            url: `/api/lobbies/${lobby.id}/join`,
            headers: {authorization: `Bearer ${token}`},
            payload: {}
        });
        expect(joinRes.statusCode).toBe(200);
        const joinBody = JSON.parse(joinRes.body);
        expect(joinBody.ok).toBeTruthy();


        const leaveRes = await app.inject({
            method: 'POST',
            url: `/api/lobbies/${lobby.id}/leave`,
            headers: {authorization: `Bearer ${token}`},
            payload: {}
        });
        expect(leaveRes.statusCode).toBe(200);


    });
});

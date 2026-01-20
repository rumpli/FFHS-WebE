/**
 * lobby.ws.test.ts
 *
 * WebSocket integration tests for lobby flows. This suite starts a real
 * Fastify server with the WS plugin and uses a real Prisma DB when available.
 * Tests authenticate with a signed token and validate lobby state updates
 * are sent to connected clients.
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import {WebSocket as WebSocketClient} from 'ws';
import {registerHttpRoutes} from '../src/http/routes.js';
import {registerWs} from '../src/ws/index.js';
import {prisma} from '../src/db/prisma.js';
import {signAccessToken} from '../src/auth/jwt.js';

let skipTests = false;

describe('lobby websocket integration', () => {
    let app: any;
    let serverUrl: string;
    let user: any;
    let token: string;

    beforeAll(async () => {
        try {
            await prisma.$connect();
        } catch (err) {
            console.warn('[test] prisma DB unavailable, skipping lobby ws tests');
            skipTests = true;
            return;
        }


        await prisma.lobbyPlayer.deleteMany({where: {}}).catch(() => {
        });
        await prisma.lobby.deleteMany({where: {}}).catch(() => {
        });
        await prisma.deck.deleteMany({where: {}}).catch(() => {
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
        token = signAccessToken({sub: user.id, username: user.username});

        app = Fastify();
        await app.register(websocket);
        await registerHttpRoutes(app);
        await registerWs(app);

        await app.listen({port: 0});
        const port = (app.server.address() as any).port;
        serverUrl = `ws://127.0.0.1:${port}/ws`;
    });

    afterAll(async () => {
        if (skipTests) return;
        try {
            await prisma.lobbyPlayer.deleteMany({where: {}});
            await prisma.lobby.deleteMany({where: {}});
            await prisma.deck.deleteMany({where: {}});
            await prisma.user.deleteMany({where: {id: user.id}});
        } finally {
            try {
                await app.close();
            } catch {
            }
            await prisma.$disconnect();
        }
    });

    it('subscribe and receive lobby state and updates', async () => {
        if (skipTests) {
            console.warn('[test] skipping');
            return;
        }


        const deck = await prisma.deck.create({data: {name: 'testdeck', ownerId: user.id}});


        const fastifyInject = app.inject.bind(app);
        const res = await fastifyInject({
            method: 'POST',
            url: '/api/lobbies',
            headers: {authorization: `Bearer ${token}`},
            payload: {maxPlayers: 2}
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.ok).toBeTruthy();
        const lobby = body.lobby;
        expect(lobby).toBeTruthy();


        const ws = new WebSocketClient(serverUrl);

        const messages: any[] = [];
        await new Promise<void>((resolve, reject) => {
            ws.on('open', () => {

            });

            ws.on('message', (data) => {
                try {
                    const m = JSON.parse(String(data));
                    messages.push(m);

                    if (m.type === 'HELLO') {
                        ws.send(JSON.stringify({v: 1, type: 'AUTH', token}));
                    } else if (m.type === 'AUTH_OK') {

                        ws.send(JSON.stringify({v: 1, type: 'LOBBY_SUBSCRIBE', lobbyId: lobby.id}));
                    } else if (m.type === 'LOBBY_STATE' && m.lobby && m.lobby.id === lobby.id) {

                        if (!m.lobby.players || m.lobby.players.length === 0) return;
                        const me = m.lobby.players.find((p: any) => p.userId === user.id);

                        ws.send(JSON.stringify({v: 1, type: 'LOBBY_SET_DECK', lobbyId: lobby.id, deckId: deck.id}));

                        ws.send(JSON.stringify({v: 1, type: 'LOBBY_SET_READY', lobbyId: lobby.id, isReady: true}));

                        setTimeout(() => resolve(), 200);
                    }
                } catch (err) {
                    reject(err);
                }
            });

            ws.on('error', (err) => reject(err));
        });


        ws.close();


        const lobbyStates = messages.filter(m => m.type === 'LOBBY_STATE' && m.lobby && m.lobby.id === lobby.id);
        expect(lobbyStates.length).toBeGreaterThanOrEqual(1);
        const latest = lobbyStates[lobbyStates.length - 1];
        const me = latest.lobby.players.find((p: any) => p.userId === user.id);
        expect(me).toBeTruthy();

        expect(me.deckId === deck.id || me.isReady === true).toBeTruthy();
    }, 20000);
});


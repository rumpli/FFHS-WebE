#!/usr/bin/env tsx
/**
 * smoke-round-end.ts
 *
 * Quick integration smoke test for the WS registry: starts a Fastify server
 * with the project's websocket handler, opens two websocket clients, has them
 * join the same match room and broadcasts a `MATCH_ROUND_END` payload. The
 * script then verifies both clients received exactly one such message.
 */

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import {registerWs} from '../src/ws/index.js';
import * as ws from 'ws';

const WebSocket: any = (ws as any).default ?? (ws as any);
import {joinRoom, broadcastRoom} from '../src/ws/registry.js';

async function startServer(port = 8081) {
    const app = Fastify({logger: false});
    await app.register(websocket);
    // register the application's websocket routes and handlers
    await registerWs(app as any);
    await app.listen({port, host: '127.0.0.1'});
    return app;
}

async function run() {
    const port = 8081;
    const app = await startServer(port);
    const url = `ws://127.0.0.1:${port}/ws`;

    const msgsA: any[] = [];
    const msgsB: any[] = [];

    let connIdA: string | null = null;
    let connIdB: string | null = null;

    const a = new WebSocket(url);
    const b = new WebSocket(url);

    // Collect messages from each socket and capture HELLO connId messages
    a.on('message', (d) => {
        try {
            const msg = JSON.parse(d.toString());
            msgsA.push(msg);
            if (msg && msg.type === 'HELLO' && msg.connId) connIdA = msg.connId;
        } catch (e) {
        }
    });
    b.on('message', (d) => {
        try {
            const msg = JSON.parse(d.toString());
            msgsB.push(msg);
            if (msg && msg.type === 'HELLO' && msg.connId) connIdB = msg.connId;
        } catch (e) {
        }
    });

    await new Promise((res) => {
        let opened = 0;
        a.on('open', () => {
            opened++;
            if (opened === 2) {
                setTimeout(res, 200);
            }
        });
        b.on('open', () => {
            opened++;
            if (opened === 2) {
                setTimeout(res, 200);
            }
        });
    });

    await new Promise((r) => setTimeout(r, 200));

    if (!connIdA || !connIdB) {
        console.error('Failed to obtain HELLO connIds:', {connIdA, connIdB});
        await app.close();
        process.exit(1);
    }

    const matchId = 'smoke-m';
    const room = `match:${matchId}`;

    try {
        // Join both connections to the same match room in the registry
        joinRoom(connIdA, room);
        joinRoom(connIdB, room);
    } catch (e) {
        console.error('Failed to join room for connIds', {connIdA, connIdB, err: e});
    }

    const payload = {
        type: 'MATCH_ROUND_END',
        v: 1,
        matchId,
        round: 1,
        phase: 'shop',
    } as const;
    // Broadcast to the room; connected clients should receive this
    broadcastRoom(room, payload);

    await new Promise((r) => setTimeout(r, 300));

    const countA = msgsA.filter(m => m && m.type === 'MATCH_ROUND_END').length;
    const countB = msgsB.filter(m => m && m.type === 'MATCH_ROUND_END').length;

    console.log('MATCH_ROUND_END counts:', {a: countA, b: countB});

    await app.close();

    if (countA === 1 && countB === 1) {
        console.log('SMOKE PASS');
        process.exit(0);
    } else {
        console.error('SMOKE FAIL');
        process.exit(2);
    }
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});

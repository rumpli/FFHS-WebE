/**
 * lobbies.test.ts
 *
 * HTTP-level integration tests for lobby creation, joining and starting flows.
 * These tests mock `prisma` and other dependencies to validate route handlers
 * under various conditions including code-protected joins and match creation.
 */

import Fastify from 'fastify';
import {beforeEach, afterEach, describe, it, expect, vi} from 'vitest';


const lobbies: any[] = [];
const lobbyPlayers: any[] = [];
const users: Record<string, any> = {
    user1: {id: 'user1', username: 'alice'},
    user2: {id: 'user2', username: 'bob'},
};
let lobbyCounter = 1;

function findLobbyByWhere(where: any, include?: any) {
    const key = Object.keys(where)[0];
    const val = where[key];
    const lobby = lobbies.find((l) => (l as any)[key] === val) ?? null;
    if (!lobby) return null;
    const result: any = {...lobby};
    if (include?.players) {
        const playersRaw = lobbyPlayers.filter((p) => p.lobbyId === lobby.id);
        result.players = playersRaw.map((p: any) => {
            const out: any = {
                userId: p.userId,
                joinedAt: p.joinedAt,
                deckId: p.deckId ?? null,
                isReady: !!p.isReady,
            };
            if (include.players.include?.user?.select) {
                out.user = {id: users[p.userId].id, username: users[p.userId].username};
            }
            return out;
        });
    }
    if (include?.owner) {
        result.owner = {id: users[lobby.ownerId].id, username: users[lobby.ownerId].username};
    }
    return result;
}

const mockPrisma = {
    lobby: {
        findUnique: vi.fn(async (opts: any) => findLobbyByWhere(opts.where, opts.include)),
        create: vi.fn(async ({data}: any) => {
            const id = `lobby-${lobbyCounter++}`;
            const lobby = {
                id,
                ownerId: data.ownerId,
                maxPlayers: data.maxPlayers ?? 2,
                code: data.code ?? null,
                status: data.status ?? 'OPEN',
                matchId: data.matchId ?? null,
            };
            lobbies.push(lobby);
            return {...lobby};
        }),
        update: vi.fn(async ({where, data}: any) => {
            const l = lobbies.find((x) => x.id === where.id);
            if (!l) return null;
            Object.assign(l, data);
            return {...l};
        }),
        delete: vi.fn(async ({where}: any) => {
            const idx = lobbies.findIndex((x) => x.id === where.id);
            if (idx >= 0) lobbies.splice(idx, 1);
            return {};
        }),
    },
    lobbyPlayer: {
        create: vi.fn(async ({data}: any) => {
            const entry = {
                lobbyId: data.lobbyId,
                userId: data.userId,
                joinedAt: Date.now(),
                deckId: data.deckId ?? null,
                isReady: data.isReady ?? false
            };
            lobbyPlayers.push(entry);
            return entry;
        }),
        findFirst: vi.fn(async ({where}: any) => {
            return lobbyPlayers.find((p) => p.lobbyId === where.lobbyId && p.userId === where.userId) ?? null;
        }),
        deleteMany: vi.fn(async ({where}: any) => {
            for (let i = lobbyPlayers.length - 1; i >= 0; i--) {
                if (lobbyPlayers[i].lobbyId === where.lobbyId && lobbyPlayers[i].userId === where.userId) {
                    lobbyPlayers.splice(i, 1);
                }
            }
            return {count: 1};
        }),
        count: vi.fn(async ({where}: any) => {
            return lobbyPlayers.filter((p) => p.lobbyId === where.lobbyId).length;
        }),
        findFirst_orderBy: vi.fn(async ({where}: any) => {

            const arr = lobbyPlayers.filter((p) => p.lobbyId === where.lobbyId);
            if (arr.length === 0) return null;
            arr.sort((a, b) => a.joinedAt - b.joinedAt);
            return arr[0];
        }),
    },
    match: {
        create: vi.fn(async ({data}: any) => ({id: `match-${Date.now()}`, ...data})),
    },
    matchPlayer: {
        create: vi.fn(async ({data}: any) => data),
    },
    $transaction: vi.fn(async (fn: any) => {

        const tx = {
            match: mockPrisma.match,
            matchPlayer: mockPrisma.matchPlayer,
            lobby: mockPrisma.lobby,
            lobbyPlayer: mockPrisma.lobbyPlayer,

            deck: {
                findUnique: vi.fn(async () => null),
                findFirst: vi.fn(async () => null),
            },
        };
        return fn(tx as any);
    }),
    __testHelpers: {
        _reset: () => {
            lobbies.length = 0;
            lobbyPlayers.length = 0;
            lobbyCounter = 1;
        },

    },
};

vi.mock('../src/db/prisma.js', () => ({prisma: mockPrisma}));
vi.mock('../src/auth/jwt.js', () => ({
    verifyAccessToken: vi.fn((token: string) => {
        token = String(token ?? '');
        if (token === 'tok1') return {sub: 'user1'} as any;
        if (token === 'tok2') return {sub: 'user2'} as any;
        throw new Error('INVALID');
    }),
}));
vi.mock('../src/ws/registry.js', () => ({
    broadcastRoom: vi.fn(() => {
    })
}));
vi.mock('../src/ws/index.js', () => ({
    scheduleRoundTimeout: vi.fn(async (_matchId: string) => {
    }),
    broadcastMatchState: vi.fn(async (_matchId: string) => {
    }),
}));
vi.mock('../src/ws/matchState.js', async () => {
    const actual: any = await vi.importActual('../src/ws/matchState.js');
    return {
        ...actual,

        randomShopWeighted: vi.fn(async (_round: number) => []),
    };
});


let registerLobbyRoutes: any;
let prisma: any;
let broadcastRoom: any;
let verifyAccessToken: any;

beforeEach(async () => {

    mockPrisma.__testHelpers._reset();

    vi.clearAllMocks();

    const mod = await import('../src/http/lobbies');
    registerLobbyRoutes = mod.registerLobbyRoutes;
    const pmod = await import('../src/db/prisma.js');
    prisma = pmod.prisma;
    const wsMod = await import('../src/ws/registry.js');
    broadcastRoom = wsMod.broadcastRoom;
    const jwtMod = await import('../src/auth/jwt.js');
    verifyAccessToken = jwtMod.verifyAccessToken;
});

afterEach(async () => {

});

describe('lobbies create / join flows', () => {
    it('create lobby with custom code', async () => {
        const app = Fastify();
        await registerLobbyRoutes(app);

        const resp = await app.inject({
            method: 'POST',
            url: '/api/lobbies',
            headers: {authorization: 'Bearer tok1'},
            payload: {code: 'CUSTOM1', maxPlayers: 4},
        });
        expect(resp.statusCode).toBe(201);
        const body = resp.json();
        expect(body.ok).toBe(true);
        expect(body.lobby.code).toBe('CUSTOM1');
        expect(body.lobby.ownerId).toBe('user1');
        expect(broadcastRoom).toHaveBeenCalled();
        await app.close();
    });

    it('create lobby without code does not auto-generate a code', async () => {
        const app = Fastify();
        await registerLobbyRoutes(app);

        const resp = await app.inject({
            method: 'POST',
            url: '/api/lobbies',
            headers: {authorization: 'Bearer tok1'},
            payload: {},
        });
        expect(resp.statusCode).toBe(201);
        const body = resp.json();
        expect(body.ok).toBe(true);

        expect(body.lobby.code === null || body.lobby.code === undefined).toBe(true);
        await app.close();
    });

    it('join by id requires matching body.code; join by code in URL works without body', async () => {
        const app = Fastify();
        await registerLobbyRoutes(app);


        const createResp = await app.inject({
            method: 'POST',
            url: '/api/lobbies',
            headers: {authorization: 'Bearer tok1'},
            payload: {code: 'CODE1', maxPlayers: 4},
        });
        expect(createResp.statusCode).toBe(201);
        const created = createResp.json().lobby;


        const wrongJoin = await app.inject({
            method: 'POST',
            url: `/api/lobbies/${created.id}/join`,
            headers: {authorization: 'Bearer tok2'},
            payload: {code: 'WRONG'},
        });
        expect(wrongJoin.statusCode).toBe(403);
        expect(wrongJoin.json().error).toBe('BAD_CODE');


        const okJoin = await app.inject({
            method: 'POST',
            url: `/api/lobbies/${created.id}/join`,
            headers: {authorization: 'Bearer tok2'},
            payload: {code: 'CODE1'},
        });
        expect(okJoin.statusCode).toBe(200);
        const joinedBody = okJoin.json();
        expect(joinedBody.ok).toBe(true);
        expect(joinedBody.lobby.players.some((p: any) => p.user && p.user.id === 'user2')).toBe(true);


        const joinByCode = await app.inject({
            method: 'POST',
            url: `/api/lobbies/CODE1/join`,
            headers: {authorization: 'Bearer tok2'},
            payload: {},
        });
        expect(joinByCode.statusCode).toBe(200);
        expect(joinByCode.json().ok).toBe(true);

        await app.close();
    });

    it('start lobby creates a match with match players and initialized state (and requires all ready)', async () => {
        const app = Fastify();
        await registerLobbyRoutes(app);


        const createResp = await app.inject({
            method: 'POST',
            url: '/api/lobbies',
            headers: {authorization: 'Bearer tok1'},
            payload: {maxPlayers: 2},
        });
        expect(createResp.statusCode).toBe(201);
        const createdLobby = createResp.json().lobby;


        const joinResp = await app.inject({
            method: 'POST',
            url: `/api/lobbies/${createdLobby.id}/join`,
            headers: {authorization: 'Bearer tok2'},
            payload: {},
        });
        expect(joinResp.statusCode).toBe(200);


        const startNotReady = await app.inject({
            method: 'POST',
            url: `/api/lobbies/${createdLobby.id}/start`,
            headers: {authorization: 'Bearer tok1'},
            payload: {},
        });
        expect(startNotReady.statusCode).toBe(409);
        expect(startNotReady.json().error).toBe('NOT_ALL_READY');


        for (const lp of lobbyPlayers) {
            if (lp.lobbyId === createdLobby.id) lp.isReady = true;
        }


        const startOk = await app.inject({
            method: 'POST',
            url: `/api/lobbies/${createdLobby.id}/start`,
            headers: {authorization: 'Bearer tok1'},
            payload: {},
        });
        expect(startOk.statusCode).toBe(200);
        const startBody = startOk.json();
        expect(startBody.ok).toBe(true);
        expect(typeof startBody.matchId).toBe('string');


        expect((mockPrisma.match.create as any).mock.calls.length).toBe(1);

        expect((mockPrisma.match.create as any).mock.calls[0][0].data.status).toBe('RUNNING');
        expect((mockPrisma.matchPlayer.create as any).mock.calls.length).toBe(2);

        const createdPlayers = (mockPrisma.matchPlayer.create as any).mock.calls.map((c: any[]) => c[0].data);
        const uids = createdPlayers.map((p: any) => p.userId).sort();
        expect(uids).toEqual(['user1', 'user2']);


        for (const p of createdPlayers) {

            expect(p.isReady).toBe(true);
            expect(p.matchId).toBe(startBody.matchId);
            expect(p.state).toBeTruthy();

            const s = typeof p.state === 'string' ? JSON.parse(p.state) : p.state;
            expect(s.round).toBe(1);
            expect(s.towerLevel).toBe(1);
            expect(Array.isArray(s.board)).toBe(true);
        }


        expect((mockPrisma.lobby.update as any).mock.calls.length).toBeGreaterThan(0);

        await app.close();
    });
});


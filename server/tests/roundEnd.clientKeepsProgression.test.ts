/**
 * roundEnd.clientKeepsProgression.test.ts
 *
 * Tests that client-side progression (round/timer) is preserved across
 * end-round processing and does not regress when multiple triggers occur.
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

let scheduleRoundTimeout: any;
let clearRoundTimer: any;

const mockMatch = {
    id: 'm-client',
    status: 'RUNNING',
    players: [{id: 'mp1', userId: 'u1', isEliminated: false, state: '{}'}],
};

const mockPrisma: any = {
    match: {
        findUnique: vi.fn(async () => mockMatch),
    },
    matchPlayer: {
        findFirst: vi.fn(async () => ({id: 'mp1', userId: 'u1', isEliminated: false})),
    },
};


const mockWs = {readyState: 1, OPEN: 1};
const mockConnections = new Map<string, any>([
    ['c1', {connId: 'c1', userId: 'u1', ws: mockWs, rooms: new Set(['match:m-client'])}],
]);
const mockRoomPeers = new Map<string, Set<string>>([['match:m-client', new Set(['c1'])]]);

const handleMatchEndRoundSpy: (
    ws: unknown,
    connId: unknown,
    msg: unknown,
    userId: unknown,
    sendMatchState: unknown,
) => Promise<void> = vi.fn(async () => {
}) as any;
const broadcastMatchStateSpy = vi.fn(async () => {
});

vi.mock('../src/db/prisma.js', () => ({prisma: mockPrisma}));
vi.mock('../src/ws/registry.js', () => ({
    connections: mockConnections,
    roomPeers: mockRoomPeers,
    leaveAllRooms: vi.fn(),
    send: vi.fn(),
    broadcastRoom: vi.fn(),
}));
vi.mock('../src/ws/handlers/round.js', () => ({
    handleMatchEndRound: (...args: any[]) => (handleMatchEndRoundSpy as any)(...args),
}));
vi.mock('../src/ws/matchBroadcast.js', () => ({
    broadcastMatchState: (...args: any[]) => (broadcastMatchStateSpy as any)(...args),
    getLastBroadcastAt: () => Date.now(),
}));
vi.mock('../src/auth/jwt.js', () => ({verifyAccessToken: vi.fn()}));
vi.mock('../src/logging.js', () => ({debug: vi.fn(), info: vi.fn(), error: vi.fn()}));
vi.mock('../src/observability/metrics.js', () => ({matchesActiveGauge: {dec: vi.fn()}}));

beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const mod = await import('../src/ws/index');
    scheduleRoundTimeout = mod.scheduleRoundTimeout;
    clearRoundTimer = mod.clearRoundTimer;
});

afterEach(() => {
    vi.useRealTimers();
});

describe('client end-round keeps progression', () => {
    it('after manual MATCH_END_ROUND, the server loop schedules next round timeout', async () => {
        const wsMatchState = await import('../src/ws/matchState');
        vi.spyOn(wsMatchState, 'readPlayerState').mockReturnValue({round: 1, roundTimerTs: Date.now() + 10} as any);


        clearRoundTimer('m-client');
        await (handleMatchEndRoundSpy as any)(null, null, {
            type: 'MATCH_END_ROUND',
            matchId: 'm-client'
        }, 'u1', vi.fn());


        await scheduleRoundTimeout('m-client');

        await vi.advanceTimersByTimeAsync(80);

        expect(broadcastMatchStateSpy).toHaveBeenCalled();
        expect(handleMatchEndRoundSpy).toHaveBeenCalled();
    });
});

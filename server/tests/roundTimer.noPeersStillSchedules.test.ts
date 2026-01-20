/**
 * roundTimer.noPeersStillSchedules.test.ts
 *
 * Verifies the round timer scheduling logic still schedules an auto-end when
 * a match has no current WS peers but recent activity indicates it should run.
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

let scheduleRoundTimeout: any;

const mockMatch = {
    id: 'm-np',
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


const mockConnections = new Map<string, any>();
const mockRoomPeers = new Map<string, Set<string>>();

const handleMatchEndRoundSpy = vi.fn(async () => {
});
const broadcastMatchStateSpy = vi.fn(async () => {
});


const recentLastBroadcastAtByMatchId = new Map<string, number>([['m-np', Date.now()]]);

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
    getLastBroadcastAt: (matchId: string) => recentLastBroadcastAtByMatchId.get(matchId) ?? Date.now(),
}));
vi.mock('../src/auth/jwt.js', () => ({verifyAccessToken: vi.fn()}));
vi.mock('../src/logging.js', () => ({debug: vi.fn(), info: vi.fn(), error: vi.fn()}));
vi.mock('../src/observability/metrics.js', () => ({matchesActiveGauge: {dec: vi.fn()}}));

beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const mod = await import('../src/ws/index');
    scheduleRoundTimeout = mod.scheduleRoundTimeout;
});

afterEach(() => {
    vi.useRealTimers();
});


import {getLastBroadcastAt} from '../src/ws/matchBroadcast.js';

describe('round timer scheduling without peers', () => {
    it('still schedules/fires for RUNNING match with recent activity (prevents stalls on reconnect)', async () => {

        expect(typeof getLastBroadcastAt).toBe('function');

        const wsMatchState = await import('../src/ws/matchState');
        vi.spyOn(wsMatchState, 'readPlayerState').mockReturnValue({round: 1, roundTimerTs: Date.now() + 10} as any);

        await scheduleRoundTimeout('m-np');

        await vi.advanceTimersByTimeAsync(80);

        expect(handleMatchEndRoundSpy).toHaveBeenCalledTimes(1);
        expect(broadcastMatchStateSpy).toHaveBeenCalledTimes(1);
    });
});

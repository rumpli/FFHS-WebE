/**
 * roundTimer.progression.test.ts
 *
 * Tests for the round timer progression, ensuring scheduled timeouts fire and
 * the end-round flow triggers expected broadcasts and scheduling continuation.
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';


let scheduleRoundTimeout: any;

const mockMatch = {id: 'm1', status: 'RUNNING', players: [{id: 'mp1', userId: 'u1', isEliminated: false, state: '{}'}]};

const mockPrisma: any = {
    match: {
        findUnique: vi.fn(async () => mockMatch),
    },
    matchPlayer: {
        findFirst: vi.fn(async () => ({id: 'mp1', userId: 'u1', isEliminated: false})),
    },
};


const mockConnections = new Map<string, any>([
    [
        'c1',
        {
            connId: 'c1',
            userId: 'u1',

            ws: {readyState: 1, OPEN: 1},
            connectedAt: Date.now(),
        },
    ],
]);
const mockRoomPeers = new Map<string, Set<string>>([['match:m1', new Set(['c1'])]]);

const handleMatchEndRoundSpy: (
    ws: unknown,
    connId: unknown,
    msg: unknown,
    userId: unknown,
    sendMatchState: unknown,
) => Promise<void> = vi.fn(async () => {
}) as any;

const broadcastMatchStateSpy: (matchId: string) => Promise<void> = vi.fn(async () => {
}) as any;

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

describe('round timer progression', () => {
    it('timer firing invokes handleMatchEndRound, then broadcasts state and reschedules', async () => {

        const wsMatchState = await import('../src/ws/matchState');
        vi.spyOn(wsMatchState, 'readPlayerState').mockReturnValue({round: 1, roundTimerTs: Date.now() + 10} as any);

        await scheduleRoundTimeout('m1');


        await vi.advanceTimersByTimeAsync(80);

        expect(handleMatchEndRoundSpy).toHaveBeenCalledTimes(1);
        expect(broadcastMatchStateSpy).toHaveBeenCalledTimes(1);


        expect(mockPrisma.match.findUnique.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
});

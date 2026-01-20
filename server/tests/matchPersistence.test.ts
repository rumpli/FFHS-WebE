/**
 * matchPersistence.test.ts
 *
 * Integration tests for match persistence and result-building. These tests
 * require a running Prisma database and will be skipped if none is available.
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {prisma} from '../src/db/prisma.js';
import {persistMatchResult, buildMatchResult} from '../src/match/persistence.js';
import {MatchStatus} from '@prisma/client';

let skipTests = false;


describe('match persistence integration', () => {
    let userA: any;
    let userB: any;
    let matchId: string;

    beforeAll(async () => {

        try {
            await prisma.$connect();
        } catch (err) {
            console.warn('[test] prisma DB unavailable, skipping match persistence integration test');
            skipTests = true;
            return;
        }

        try {

            await prisma.matchAction.deleteMany({where: {}});
            await prisma.matchRound.deleteMany({where: {}});
            await prisma.matchPlayer.deleteMany({where: {}});
            await prisma.match.deleteMany({where: {}});
            await prisma.user.deleteMany({where: {username: {contains: 'test-persist-'}}});

            userA = await prisma.user.create({
                data: {
                    username: 'test-persist-a-' + Date.now(),
                    email: `a-${Date.now()}@example.test`,
                    passwordHash: 'x'
                }
            });
            userB = await prisma.user.create({
                data: {
                    username: 'test-persist-b-' + Date.now(),
                    email: `b-${Date.now()}@example.test`,
                    passwordHash: 'x'
                }
            });

            const m = await prisma.match.create({data: {status: MatchStatus.RUNNING}});
            matchId = m.id;

            await prisma.matchPlayer.createMany({
                data: [
                    {matchId, userId: userA.id, seat: 0, totalDamageOut: 5, totalDamageTaken: 2, goldEarned: 3},
                    {matchId, userId: userB.id, seat: 1, totalDamageOut: 2, totalDamageTaken: 5, goldEarned: 1},
                ]
            });


            await prisma.matchRound.create({
                data: {
                    matchId,
                    round: 1,
                    summary: {a: 1},
                    state: {dummy: true},
                    events: [{
                        type: 'damage',
                        fromUserId: userA.id,
                        toUserId: userB.id,
                        amount: 5,
                        atMsOffset: 0
                    }] as any
                }
            });
        } catch (err) {
            console.warn('[test] setup failed, skipping match persistence integration test', err);
            skipTests = true;
        }
    });

    afterAll(async () => {
        if (skipTests) return;
        try {

            await prisma.matchAction.deleteMany({where: {matchId}});
            await prisma.matchRound.deleteMany({where: {matchId}});
            await prisma.matchPlayer.deleteMany({where: {matchId}});
            await prisma.match.deleteMany({where: {id: matchId}});
            await prisma.user.deleteMany({where: {id: {in: [userA.id, userB.id]}}});
        } finally {
            try {
                await prisma.$disconnect();
            } catch {
            }
        }
    });

    it('persists match result when match is finished', async () => {
        if (skipTests) {
            console.warn('[test] skipping persistMatchResult test due to unavailable DB');
            return;
        }


        await prisma.match.update({where: {id: matchId}, data: {status: MatchStatus.FINISHED}});


        const before = await prisma.match.findUnique({where: {id: matchId}}) as any;
        expect(before.result).toBeNull();


        await persistMatchResult(matchId);


        const after = await prisma.match.findUnique({where: {id: matchId}}) as any;
        expect(after).not.toBeNull();
        expect(after.result).toBeTruthy();
        expect(after.result.matchId).toBe(matchId);
        expect(Array.isArray(after.result.rounds)).toBe(true);
        expect(after.result.rounds.length).toBeGreaterThan(0);


        const players = await prisma.matchPlayer.findMany({where: {matchId}}) as any[];
        expect(players.length).toBe(2);
        for (const p of players) {
            expect((p as any).stats).toBeTruthy();

            expect(typeof (p as any).stats.damageOut === 'number').toBeTruthy();
            expect(typeof (p as any).stats.damageIn === 'number').toBeTruthy();
        }


        const built = await buildMatchResult(matchId);
        expect(built).not.toBeNull();
        expect(built?.matchId).toBe(matchId);
        expect(built?.rounds?.length).toBeGreaterThan(0);
    });
});

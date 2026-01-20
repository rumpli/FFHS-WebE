/**
 * round.ts
 *
 * WebSocket handlers to drive round lifecycle. The core responsibilities here
 * include:
 * - processing end-of-round requests (`MATCH_END_ROUND`) in a robust,
 *   idempotent manner (locks, deduping, and local run-with-lock helpers)
 * - invoking the simulator to compute combat outcomes
 * - persisting player state updates, advancing rounds, and closing matches
 * - building and broadcasting replay/battle update payloads for clients
 *
 * The file coordinates DB transactions, simulator calls, and resilient
 * broadcasting so that clients receive deterministic results without
 * race-conditions.
 */

import {MatchStatus, MatchPlayer} from "@prisma/client";
import {prisma} from "../../db/prisma.js";
import type {ClientMsg} from "../protocol.js";
import {joinRoom} from "../registry.js";
import {
    readPlayerState,
    savePlayerStateJson,
    snapshotRound,
    drawCards,
    MATCH_CONFIG,
    randomShopWeighted,
    baseGoldForRound,
    roundDurationMsForRound,
    getShopOfferCount,
    shuffleArray,
    MatchPlayerStateJson,
} from "../matchState.js";
import {broadcastMatchState, clearRoundTimer} from "../index.js";
import type {WsBattleUpdateMsg, BattleEvent} from "../../../../shared/protocol/types/match.js";
import {connections, send, broadcastRoom, roomPeers} from "../registry.js";
import type {WebSocket} from "ws";
import {prepareShopTransition} from "../../match/roundUtils.js";
import {debug, error} from "../../logging.js";
import {CardDef, simulateBattle, type BattleResult} from "../../sim/simulator.js";

const matchRoom = (matchId: string) => `match:${matchId}`;
const endRoundLocks = new Set<string>();
const roundEndBroadcasts = new Set<string>();
const battleUpdateBroadcasts = new Set<string>();
const lastProcessedRound = new Map<string, number>();
const processingRounds = new Set<string>();

async function applyRoundResults(matchId: string, _round: number): Promise<{
    events: BattleEvent[];
    sim?: BattleResult
}> {
    let battleEvents: BattleEvent[] = [];
    let simResult: BattleResult | undefined = undefined;
    await prisma.$transaction(async (tx) => {
        const players = await tx.matchPlayer.findMany({
            where: {matchId},
            include: {user: true},
        });
        if (!players.length) return;
        const allBoardCardIds = new Set<string>();
        for (const mp of players) {
            const st = readPlayerState(mp as MatchPlayer);
            for (const s of st.board) {
                if (s.cardId) allBoardCardIds.add(s.cardId);
            }
        }
        const allDefs = allBoardCardIds.size > 0
            ? await tx.cardDefinition.findMany({
                where: {id: {in: Array.from(allBoardCardIds)}},
                select: {
                    id: true,
                    baseDamage: true,
                    type: true,
                    config: true,
                    baseHpBonus: true,
                },
            })
            : [];
        const globalDefMap = new Map<string, any>();
        for (const d of allDefs) globalDefMap.set(d.id, {
            baseDamage: (d as any).baseDamage ?? 0,
            type: (d as any).type ?? null,
            config: (d as any).config ?? null,
            hp: (d as any).hp ?? null,
            baseHpBonus: (d as any).baseHpBonus ?? null,
            approachTicks: (d as any).approachTicks ?? null,
            shots: (d as any).shots ?? null,
            splash: (d as any).splash ?? null,
        });

        try {
            debug('[round] card defs', {
                matchId,
                allBoardCardIds: Array.from(allBoardCardIds),
                allDefsCount: allDefs.length,
                defs: allDefs.map((d: any) => ({id: d.id, type: d.type, baseDamage: d.baseDamage}))
            });
        } catch (e) {
        }
        const stateMap = new Map<string, any>();
        for (const mp of players) {
            stateMap.set(mp.id, readPlayerState(mp as MatchPlayer));
        }
        const simDefMap = new Map<string, CardDef>();
        for (const [id, val] of globalDefMap.entries()) {
            simDefMap.set(id, {
                id,
                baseDamage: val.baseDamage ?? 0,
                type: val.type ?? null,
                config: val.config ?? null,
                hp: typeof val.hp === 'number' ? val.hp : null,
                baseHpBonus: typeof val.baseHpBonus === 'number' ? val.baseHpBonus : null,
                approachTicks: typeof val.approachTicks === 'number' ? val.approachTicks : null,
                shots: typeof val.shots === 'number' ? val.shots : null,
                splash: typeof val.splash === 'number' ? val.splash : null,
            });
        }
        const orderedPlayers = players.slice().sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
        const pA = orderedPlayers[0];
        const pB = orderedPlayers[1] ?? orderedPlayers[0];
        const stateA = JSON.parse(JSON.stringify(stateMap.get(pA.id) ?? readPlayerState(pA as MatchPlayer)));
        const stateB = JSON.parse(JSON.stringify(stateMap.get(pB.id) ?? readPlayerState(pB as MatchPlayer)));
        try {
            debug('[round] simulateBattle inputs', {
                matchId,
                stateA_board: (stateA.board || []).map((s: any) => ({cardId: s.cardId, stackCount: s.stackCount})),
                stateB_board: (stateB.board || []).map((s: any) => ({cardId: s.cardId, stackCount: s.stackCount})),
                simDefMapKeys: Array.from(simDefMap.keys()),
            });
        } catch (e) {
        }
        const sim = simulateBattle(stateA, stateB, simDefMap, {ticksToReach: MATCH_CONFIG.ticksToReach});
        simResult = sim;
        try {
            debug('[round] simulateBattle result', {
                matchId,
                ticks: sim.ticks,
                winner: sim.winner,
                aTowerHp: sim.aTowerHp,
                bTowerHp: sim.bTowerHp,
                eventsCount: Array.isArray(sim.events) ? sim.events.length : 0,
                aUnitsRemaining: Array.isArray(sim.aUnitsRemaining) ? sim.aUnitsRemaining.length : 0,
                bUnitsRemaining: Array.isArray(sim.aUnitsRemaining) ? sim.aUnitsRemaining.length : 0,
                sampleEvents: Array.isArray(sim.events) ? sim.events.slice(0, 6) : [],
            });
        } catch (e) {
        }
        const prevA_hp = stateA.towerHp ?? 0;
        const prevB_hp = stateB.towerHp ?? 0;
        const newA_hp = sim.aTowerHp;
        const newB_hp = sim.bTowerHp;
        const dmgToA = Math.max(0, prevA_hp - newA_hp);
        const dmgToB = Math.max(0, prevB_hp - newB_hp);
        const targetAState = stateMap.get(pA.id);
        const targetBState = stateMap.get(pB.id);
        if (targetAState) {
            targetAState.totalDamageIn = (targetAState.totalDamageIn ?? 0) + dmgToA;
            targetAState.totalDamageOut = (targetAState.totalDamageOut ?? 0) + dmgToB;
            targetAState.towerHp = Math.max(0, newA_hp);
            stateMap.set(pA.id, targetAState);
        }
        if (targetBState) {
            targetBState.totalDamageIn = (targetBState.totalDamageIn ?? 0) + dmgToB;
            targetBState.totalDamageOut = (targetBState.totalDamageOut ?? 0) + dmgToA;
            targetBState.towerHp = Math.max(0, newB_hp);
            stateMap.set(pB.id, targetBState);
        }
        try {
            const offenderA = Array.isArray(stateA.hand) && stateA.hand.includes('marry_refusal');
            const offenderB = Array.isArray(stateB.hand) && stateB.hand.includes('marry_refusal');
            if (offenderA) {
                if ((newB_hp ?? 0) > 0) {
                    if (targetAState) {
                        targetAState.towerHp = 0;
                        (targetAState as any).eliminationReason = 'marry_refusal';
                        stateMap.set(pA.id, targetAState);
                    }
                    if (targetBState) {
                        (targetBState as any).eliminationReason = (targetBState as any).eliminationReason ?? 'marry_proposal';
                        stateMap.set(pB.id, targetBState);
                    }
                } else {
                }
            }
            if (offenderB) {
                if ((newA_hp ?? 0) > 0) {
                    if (targetBState) {
                        targetBState.towerHp = 0;
                        (targetBState as any).eliminationReason = 'marry_refusal';
                        stateMap.set(pB.id, targetBState);
                    }
                    if (targetAState) {
                        (targetAState as any).eliminationReason = (targetAState as any).eliminationReason ?? 'marry_proposal';
                        stateMap.set(pA.id, targetAState);
                    }
                } else {

                }
            }
        } catch (e) {
            debug('[round] marry_refusal post-sim check failed', {matchId, err: e});
        }

        try {
            for (const [mpId, st] of stateMap.entries()) {
                if (!st) continue;
                try {
                    st.pendingBuffs = [];
                } catch (e) {
                }
                try {
                    delete st._simUnitMul;
                } catch (e) {
                }
                try {
                    delete st._simTowerMul;
                } catch (e) {
                }
                stateMap.set(mpId, st);
            }
        } catch (e) {

        }

        const tickMs = 100;
        battleEvents = [];
        try {
            if (simResult && Array.isArray((simResult as any).events)) {
                const simEvents = (simResult as any).events ?? [];
                for (const e of simEvents) {
                    const fromUserId = e.from === 'A' ? pA.userId : pB.userId;
                    const toUserId = e.to === 'A' ? pA.userId : pB.userId;
                    const fromUsername = e.from === 'A' ? pA.user?.username ?? null : pB.user?.username ?? null;
                    const toUsername = e.to === 'A' ? pA.user?.username ?? null : pB.user?.username ?? null;
                    const be: any = {
                        type: 'damage',
                        fromUserId,
                        fromUsername,
                        toUserId,
                        toUsername,
                        amount: e.amount,
                        atMsOffset: e.tick * tickMs
                    };
                    if (e && typeof e.target !== 'undefined') be.target = e.target;
                    battleEvents.push(be as BattleEvent);
                }
            } else {
                const targetAState = stateMap.get(pA.id);
                const targetBState = stateMap.get(pB.id);
                const synthA = targetAState?.totalDamageOut ?? 0;
                const synthB = targetBState?.totalDamageOut ?? 0;
                if (synthA > 0) battleEvents.push({
                    type: 'damage',
                    fromUserId: pA.userId,
                    fromUsername: pA.user?.username ?? null,
                    toUserId: pB.userId,
                    toUsername: pB.user?.username ?? null,
                    amount: synthA,
                    atMsOffset: 0
                });
                if (synthB > 0) battleEvents.push({
                    type: 'damage',
                    fromUserId: pB.userId,
                    fromUsername: pB.user?.username ?? null,
                    toUserId: pA.userId,
                    toUsername: pA.user?.username ?? null,
                    amount: synthB,
                    atMsOffset: 0
                });
            }
        } catch (err) {
            error('[round] failed to construct battle events from simulator', {matchId, err});
            const targetAState = stateMap.get(pA.id);
            const targetBState = stateMap.get(pB.id);
            const dmgToA = Math.max(0, (targetAState?.totalDamageIn ?? 0));
            const dmgToB = Math.max(0, (targetBState?.totalDamageIn ?? 0));
            battleEvents.push({
                type: 'damage',
                fromUserId: pA.userId,
                fromUsername: pA.user?.username ?? null,
                toUserId: pB.userId,
                toUsername: pB.user?.username ?? null,
                amount: dmgToB,
                atMsOffset: 0
            });
            battleEvents.push({
                type: 'damage',
                fromUserId: pB.userId,
                fromUsername: pB.user?.username ?? null,
                toUserId: pA.userId,
                toUsername: pA.user?.username ?? null,
                amount: dmgToA,
                atMsOffset: 0
            });
        }

        for (const mp of players) {
            const state = stateMap.get(mp.id);
            if (!state) continue;
            state.round = (state.round ?? 1) + 1;
            state.phase = "combat";
            state.roundTimerTs = null;
            const eliminated = state.towerHp <= 0;
            try {
                debug('[round] persisting player state (pre-merge)', {
                    matchId,
                    matchPlayerId: mp.id,
                    userId: mp.userId,
                    lastTowerUpgradeRound: state.lastTowerUpgradeRound
                });
            } catch {
            }
            const existingRow = await tx.matchPlayer.findFirst({where: {id: mp.id}});
            const existingState = existingRow ? readPlayerState(existingRow as MatchPlayer) : undefined;
            const mergedBase = existingState ? {...existingState} : {} as any;
            const toPersist = {...mergedBase, ...state} as MatchPlayerStateJson;
            toPersist.lastTowerUpgradeRound = Math.max(existingState?.lastTowerUpgradeRound ?? 0, state?.lastTowerUpgradeRound ?? 0);

            try {
                debug('[round] persisting player state (merged)', {
                    matchId,
                    matchPlayerId: mp.id,
                    userId: mp.userId,
                    lastTowerUpgradeRound: toPersist.lastTowerUpgradeRound
                });
            } catch {
            }

            await tx.matchPlayer.update({
                where: {id: mp.id},
                data: {
                    state: savePlayerStateJson(toPersist),
                    isEliminated: eliminated,
                    totalDamageOut: typeof (toPersist as any).totalDamageOut === 'number' ? (toPersist as any).totalDamageOut : undefined,
                    totalDamageTaken: typeof (toPersist as any).totalDamageIn === 'number' ? (toPersist as any).totalDamageIn : undefined,
                },
            });
        }

        const remaining = await tx.matchPlayer.count({
            where: {matchId, isEliminated: false},
        });

        if (remaining <= 1) {
            const survivor = await tx.matchPlayer.findFirst({where: {matchId, isEliminated: false}});
            const winnerUserId = survivor?.userId ?? null;
            const updateData: any = {status: MatchStatus.FINISHED, finishedAt: new Date()};
            if (winnerUserId) updateData.winnerId = winnerUserId;
            await tx.match.update({
                where: {id: matchId},
                data: updateData,
            });

            try {
                await tx.lobby.updateMany({
                    where: {matchId},
                    data: {status: 'CLOSED', matchId: null},
                });
            } catch {
            }

            if (winnerUserId) {
                await tx.matchPlayer.updateMany({where: {matchId, userId: winnerUserId}, data: {finalRank: 1}});
            }
            return;
        }
        const now = Date.now();
        const survivors = await tx.matchPlayer.findMany({
            where: {matchId, isEliminated: false},
        });
        debug('[round] applyRoundResults - survivors before shop prep', matchId, survivors.map(s => ({
            userId: s.userId,
            gold: readPlayerState(s as MatchPlayer).gold
        })));

        for (const mp of survivors) {
            const computed = stateMap.get(mp.id);
            const state = computed ?? readPlayerState(mp as MatchPlayer);
            const round = state.round ?? 1;
            state.phase = "shop";
            state.gold = baseGoldForRound(round);
            try {
                const extraPerRound = Number((state as any).goldPerRound ?? 0) || 0;
                const maxCap = Number((state as any).maxGold ?? 10) || 10;
                debug('[round] goldPerRound raw', {
                    matchId,
                    userId: mp.userId,
                    raw: (state as any).goldPerRound,
                    typeofRaw: typeof (state as any).goldPerRound,
                    maxCap
                });
                if (extraPerRound > 0) {
                    const beforeG = state.gold ?? 0;

                    state.gold = Math.min((state.gold ?? 0) + extraPerRound, maxCap);
                    debug('[round] applyRoundResults - applying goldPerRound', {
                        matchId,
                        userId: mp.userId,
                        goldPerRound: extraPerRound,
                        before: beforeG,
                        after: state.gold,
                        maxCap
                    });
                }
            } catch (err) {
            }
            debug('[round] applyRoundResults - setting base gold', {
                matchId,
                userId: mp.userId,
                round,
                gold: state.gold
            });
            state.roundTimerTs = now + roundDurationMsForRound(round);
            const boardCardIds = Array.from(new Set(state.board.map((s: {
                cardId: any;
            }) => s.cardId).filter(Boolean) as string[]));
            const typeMap = new Map<string, string>();
            if (boardCardIds.length > 0) {
                const defs = await tx.cardDefinition.findMany({
                    where: {id: {in: boardCardIds}},
                    select: {id: true, type: true},
                });
                for (const d of defs) typeMap.set(d.id, d.type as string);
            }
            prepareShopTransition(state, typeMap, (arr) => shuffleArray(arr));
            try {
                const pending = Number((state as any).pendingExtraDraws ?? 0) || 0;
                const extra = Math.max(0, pending);
                const desiredHandSize = MATCH_CONFIG.handSizePerRound + extra;
                const {drawMultipleCards} = await import("../matchState.js");
                drawMultipleCards(state as any, desiredHandSize, desiredHandSize);
                (state as any).pendingExtraDraws = 0;
            } catch (e) {
                drawCards(state, MATCH_CONFIG.handSizePerRound);
            }
            state.shop = await randomShopWeighted(getShopOfferCount(state.towerLevel), state.towerLevel);
            const existingRow2 = await tx.matchPlayer.findFirst({where: {id: mp.id}});
            const existingState2 = existingRow2 ? readPlayerState(existingRow2 as MatchPlayer) : undefined;
            const mergedBase2 = existingState2 ? {...existingState2} : {} as any;
            const toPersist2 = {...mergedBase2, ...state} as MatchPlayerStateJson;
            toPersist2.lastTowerUpgradeRound = Math.max(existingState2?.lastTowerUpgradeRound ?? 0, state?.lastTowerUpgradeRound ?? 0);
            await tx.matchPlayer.update({
                where: {id: mp.id},
                data: {state: savePlayerStateJson(toPersist2)},
            });
        }
    });
    return {events: battleEvents, sim: simResult};
}

export async function handleMatchEndRound(
    _ws: WebSocket | null,
    connId: string | null,
    msg: Extract<ClientMsg, {
        type: "MATCH_END_ROUND";
    }>,
    userId: string,
    _sendMatchState: (connId: string, matchId: string) => Promise<void>,
) {
    const LOCK_WAIT_MS = 5000;
    const POLL_INTERVAL_MS = 50;
    if (endRoundLocks.has(msg.matchId)) {
        debug('[round] end-round already in progress for', msg.matchId, '- waiting for lock to clear');
        const start = Date.now();
        while (endRoundLocks.has(msg.matchId) && Date.now() - start < LOCK_WAIT_MS) {
            await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
        }
        if (endRoundLocks.has(msg.matchId)) {
            debug('[round] waited for lock but it is still held, aborting end-round for', msg.matchId);
            return;
        }
    }
    endRoundLocks.add(msg.matchId);
    try {
        const match = await prisma.match.findUnique({
            where: {id: msg.matchId},
            include: {players: true},
        });
        if (!match || match.status !== MatchStatus.RUNNING) {
            return;
        }
        const mp = await prisma.matchPlayer.findFirst({
            where: {matchId: msg.matchId, userId},
        });
        if (!mp) {
            return;
        }
        if (connId) joinRoom(connId, matchRoom(msg.matchId));
        if (mp.isEliminated) {
            debug('[round] eliminated player attempted end-round', userId, msg.matchId);
            return;
        }
        const currentState = readPlayerState(mp as MatchPlayer);
        const currentRound = currentState.round;
        const prevProcessed = lastProcessedRound.get(msg.matchId) ?? 0;
        if (prevProcessed >= currentRound) {
            debug('[round] skipping end-round because round already processed', {
                matchId: msg.matchId,
                currentRound,
                prevProcessed
            });
            return;
        }
        const processingKey = `${msg.matchId}:${currentRound}`;
        if (processingRounds.has(processingKey)) {
            debug('[round] skipping end-round because processing already in progress', {
                matchId: msg.matchId,
                round: currentRound
            });
            return;
        }
        processingRounds.add(processingKey);
        try {
            try {
                const freshMp = await prisma.matchPlayer.findFirst({where: {matchId: msg.matchId, userId}});
                if (freshMp) {
                    const freshState = readPlayerState(freshMp as MatchPlayer);
                    if (freshState.round !== currentRound) {
                        debug('[round] detected round already advanced, skipping duplicate end-round', {
                            matchId: msg.matchId,
                            userId,
                            observedRound: currentRound,
                            persistedRound: freshState.round
                        });
                        return;
                    }
                }
            } catch (err) {
                error('[round] failed to re-read player state during duplicate-check', {
                    matchId: msg.matchId,
                    userId,
                    err
                });
            }

            const players = await prisma.matchPlayer.findMany({
                where: {matchId: msg.matchId},
                include: {user: true},
            });
            clearRoundTimer(msg.matchId);
            const broadcastKey = `${msg.matchId}:${currentRound}`;
            const ms = await import("../matchState.js");
            const runWithLocalLock = (ms && (ms.runWithLocalLock as any)) ?? (async (_: string, fn: () => Promise<any>) => fn());
            await runWithLocalLock(msg.matchId, async () => {
                const roundEndPayload = {
                    type: "MATCH_ROUND_END" as const,
                    v: 1,
                    matchId: msg.matchId,
                    round: currentRound,
                    phase: "shop" as const,
                };
                if (roundEndBroadcasts.has(broadcastKey)) {
                    debug('[round] skipping duplicate MATCH_ROUND_END broadcast (already sent)', {
                        matchId: msg.matchId,
                        round: currentRound
                    });
                    return;
                }
                roundEndBroadcasts.add(broadcastKey);
                try {
                    broadcastRoom(matchRoom(msg.matchId), roundEndPayload);
                } catch (err) {
                    error('[round] failed to broadcast MATCH_ROUND_END', {matchId: msg.matchId, err});
                }
                try {
                    const playerUserIds = new Set(players.map((p) => p.userId));
                    const sentSet = new Set<string>();
                    const peers = roomPeers.get(matchRoom(msg.matchId));
                    if (peers) for (const id of peers) sentSet.add(id);
                    let directDelivered = 0;
                    for (const [connId, ctx] of connections.entries()) {
                        try {
                            if (!ctx.userId) continue;
                            if (!playerUserIds.has(ctx.userId)) continue;
                            if (sentSet.has(connId)) continue;
                            if (ctx.ws.readyState !== ctx.ws.OPEN) continue;
                            send(ctx.ws, roundEndPayload);
                            directDelivered++;
                            sentSet.add(connId);
                        } catch (err) {
                            error('[round] failed to send MATCH_ROUND_END to connection', {connId, err});
                        }
                    }
                    if (directDelivered === 0) debug('[round] MATCH_ROUND_END direct delivered to 0 connections for', msg.matchId);
                } catch (err) {
                    error('[round] robust delivery of MATCH_ROUND_END failed', {matchId: msg.matchId, err});
                }
                const {events: battleEvents, sim} = await applyRoundResults(msg.matchId, currentRound);
                await snapshotRound(msg.matchId, currentRound);
                try {
                    try {
                        const orderedPlayersForAnnot = players.slice().sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
                        const pA = orderedPlayersForAnnot[0];
                        const pB = orderedPlayersForAnnot[1] ?? orderedPlayersForAnnot[0];
                        const simInitialA = (sim as any)?.initialAUnits ?? [];
                        const simInitialB = (sim as any)?.initialBUnits ?? [];
                        const annotatedInitial: any[] = [];
                        if (Array.isArray(simInitialA)) {
                            for (const u of simInitialA) annotatedInitial.push({...(u || {}), ownerUserId: pA.userId});
                        }
                        if (Array.isArray(simInitialB)) {
                            for (const u of simInitialB) annotatedInitial.push({...(u || {}), ownerUserId: pB.userId});
                        }
                        const simPerTick = (sim as any)?.perTickSummary ?? undefined;
                        const mappedPerTick = Array.isArray(simPerTick)
                            ? simPerTick.map((entry: any) => {
                                const aEntry = {
                                    userId: String(pA.userId ?? ""),
                                    alive: Number(entry.aAlive ?? 0),
                                    reached: Number(entry.aReached ?? 0),
                                    dead: Number(entry.aDead ?? 0),
                                    dmgToTower: Number(entry.aDmgToTower ?? 0),
                                };
                                const bEntry = {
                                    userId: String(pB.userId ?? ""),
                                    alive: Number(entry.bAlive ?? 0),
                                    reached: Number(entry.bReached ?? 0),
                                    dead: Number(entry.bDead ?? 0),
                                    dmgToTower: Number(entry.bDmgToTower ?? 0),
                                };
                                return {tick: Number(entry.tick ?? 0), entries: [aEntry, bEntry]};
                            })
                            : undefined;
                        const replayPayload: any = {
                            events: (battleEvents ?? []),
                            ticksToReach: (sim as any)?.ticksToReach ?? undefined,
                            initialUnits: annotatedInitial.length ? annotatedInitial : undefined,
                            shotsPerTick: (sim as any)?.shotsPerTick ?? undefined,
                            perTickSummary: mappedPerTick,
                        };
                        // Always attempt to persist the replay payload (even if events is empty)
                        await prisma.matchRound.updateMany({
                            where: {matchId: msg.matchId, round: currentRound},
                            data: {replay: replayPayload},
                        });
                    } catch (e) {
                        // best-effort, do not fail end-round processing
                        try {
                            error('[round] failed to persist matchRound.replay payload', {
                                matchId: msg.matchId,
                                round: currentRound,
                                err: e
                            });
                        } catch {
                        }
                    }
                } catch (err) {
                    try {
                        error('[round] failed to persist matchRound.replay payload (outer)', {
                            matchId: msg.matchId,
                            round: currentRound,
                            err
                        });
                    } catch {
                    }
                }

                // Broadcast battle events (deduped per match:round)
                try {
                    if (battleUpdateBroadcasts.has(broadcastKey)) {
                        debug('[round] skipping duplicate MATCH_BATTLE_UPDATE broadcast (already sent)', {
                            matchId: msg.matchId,
                            round: currentRound
                        });
                    } else {
                        battleUpdateBroadcasts.add(broadcastKey);
                        // Build optional postHp mapping for clients to immediately
                        // animate tower HP changes without waiting for MATCH_STATE.
                        const postHp: Record<string, number> = {};
                        for (const p of players) {
                            // current persisted state in DB is updated by applyRoundResults; read latest
                            const st = await prisma.matchPlayer.findFirst({where: {id: p.id}});
                            if (st) {
                                try {
                                    const s = readPlayerState(st as any);
                                    postHp[p.userId] = Number(s.towerHp ?? 0);
                                } catch {
                                }
                            }
                        }
                        // If simulator provided initial units, augment each unit with ownerUserId
                        // so clients can remap A/B to their local view. Use deterministic
                        // player ordering (seat asc) to match simulator's A/B mapping.
                        const simInitialA = (sim as any)?.initialAUnits ?? [];
                        const simInitialB = (sim as any)?.initialBUnits ?? [];
                        const orderedPlayersForAnnot = players.slice().sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
                        const pA = orderedPlayersForAnnot[0];
                        const pB = orderedPlayersForAnnot[1] ?? orderedPlayersForAnnot[0];

                        // Annotate initial units with ownerUserId and emit a flat array so clients can map deterministically
                        const annotatedInitial: any[] = [];
                        if (Array.isArray(simInitialA)) {
                            for (const u of simInitialA) annotatedInitial.push({...(u || {}), ownerUserId: pA.userId});
                        }
                        if (Array.isArray(simInitialB)) {
                            for (const u of simInitialB) annotatedInitial.push({...(u || {}), ownerUserId: pB.userId});
                        }

                        // Convert simulator-local events (from/to as 'A'/'B') into userId-based events
                        const orderedPlayersForAnnot2 = players.slice().sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
                        const pA2 = orderedPlayersForAnnot2[0];
                        const pB2 = orderedPlayersForAnnot2[1] ?? orderedPlayersForAnnot2[0];
                        const userEvents = (battleEvents || []).map((ev: any) => {
                            // If the event already contains userId fields (fromUserId/toUserId), use them directly.
                            if (typeof ev?.fromUserId === 'string' || typeof ev?.toUserId === 'string') {
                                return {
                                    type: 'damage' as const,
                                    fromUserId: String(ev.fromUserId ?? ""),
                                    fromUsername: ev.fromUsername ?? null,
                                    toUserId: String(ev.toUserId ?? ""),
                                    toUsername: ev.toUsername ?? null,
                                    amount: Number(ev.amount ?? 0),
                                    atMsOffset: Math.max(0, Number(ev.atMsOffset ?? ev.atMsOffset ?? 0) || 0),
                                    target: ev.target ?? 'units',
                                };
                            }
                            // Otherwise assume simulator-local 'from'/'to' notation ('A'/'B') and map using seat-ordered players
                            const from = ev.from === 'A' ? pA2.userId : pB2.userId;
                            const to = ev.to === 'A' ? pA2.userId : pB2.userId;
                            const fromName = ev.from === 'A' ? (pA2.user?.username ?? null) : (pB2.user?.username ?? null);
                            const toName = ev.to === 'A' ? (pA2.user?.username ?? null) : (pB2.user?.username ?? null);
                            return {
                                type: 'damage' as const,
                                fromUserId: String(from ?? ""),
                                fromUsername: fromName,
                                toUserId: String(to ?? ""),
                                toUsername: toName,
                                amount: Number(ev.amount ?? 0),
                                atMsOffset: Math.max(0, Number(ev.tick ?? 0) * 100),
                                target: ev.target ?? 'units',
                            };
                        });
                        // Map perTickSummary a/b into per-user entries
                        const simPerTick = (sim as any)?.perTickSummary ?? undefined;
                        const mappedPerTick = Array.isArray(simPerTick)
                            ? simPerTick.map((entry: any) => {
                                const aEntry = {
                                    userId: String(pA2.userId ?? ""),
                                    alive: Number(entry.aAlive ?? 0),
                                    reached: Number(entry.aReached ?? 0),
                                    dead: Number(entry.aDead ?? 0),
                                    dmgToTower: Number(entry.aDmgToTower ?? 0),
                                };
                                const bEntry = {
                                    userId: String(pB2.userId ?? ""),
                                    alive: Number(entry.bAlive ?? 0),
                                    reached: Number(entry.bReached ?? 0),
                                    dead: Number(entry.bDead ?? 0),
                                    dmgToTower: Number(entry.bDmgToTower ?? 0),
                                };
                                return {tick: Number(entry.tick ?? 0), entries: [aEntry, bEntry]};
                            })
                            : undefined;
                        const msgBattle: WsBattleUpdateMsg = {
                            type: "MATCH_BATTLE_UPDATE",
                            v: 1,
                            matchId: msg.matchId,
                            round: currentRound,
                            events: userEvents,
                            ticksToReach: (sim as any)?.ticksToReach ?? undefined,
                            initialUnits: annotatedInitial,
                            shotsPerTick: (sim as any)?.shotsPerTick ?? undefined,
                            perTickSummary: mappedPerTick,
                            postHp,
                        };
                        broadcastRoom(matchRoom(msg.matchId), msgBattle);
                        try {
                            const playerUserIds = new Set(players.map((p) => p.userId));
                            const seen2 = new Set<string>();
                            const room2 = matchRoom(msg.matchId);
                            const peers2 = roomPeers.get(room2);
                            if (peers2) for (const id of peers2) seen2.add(id);
                            let delivered2 = 0;
                            for (const ctx of connections.values()) {
                                try {
                                    if (!ctx.userId) continue;
                                    if (!playerUserIds.has(ctx.userId)) continue;
                                    if (seen2.has(ctx.connId)) continue;
                                    if (ctx.ws.readyState !== ctx.ws.OPEN) continue;
                                    send(ctx.ws, msgBattle);
                                    delivered2++;
                                } catch (err) {
                                    error('[round] failed to send MATCH_BATTLE_UPDATE to connection', {
                                        connId: ctx.connId,
                                        err
                                    });
                                }
                            }
                            if (delivered2 === 0) debug('[round] MATCH_BATTLE_UPDATE direct delivered to 0 connections for', msg.matchId);
                        } catch (err) {
                            error('[round] robust delivery of MATCH_BATTLE_UPDATE failed', {matchId: msg.matchId, err});
                        }
                    }
                } catch (err) {
                    error('[round] failed to broadcast battle events', {matchId: msg.matchId, err});
                }
                try {
                    await broadcastMatchState(msg.matchId);
                } catch (err) {
                    try {
                        error('[round] broadcastMatchState failed', {matchId: msg.matchId, err});
                    } catch {
                    }
                }
                try {
                    lastProcessedRound.set(msg.matchId, currentRound);
                } catch {
                }
            });
            return;
        } finally {
            processingRounds.delete(processingKey);
        }
    } finally {
        endRoundLocks.delete(msg.matchId);
    }
}

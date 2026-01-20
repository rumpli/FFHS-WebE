/**
 * board.ts
 *
 * WebSocket handlers for board-related actions within a match.
 * Responsibilities:
 * - handle placing cards from hand onto board (including merges and special cases)
 * - selling cards from the board
 * - tower upgrades triggered by players
 *
 * These handlers are thin glue between incoming client messages, match state
 * mutation helpers (`matchState`), and persistence (`prisma`). They broadcast
 * match-level updates after applying deterministic state changes.
 */

import type {WebSocket} from "ws";
import type {ClientMsg} from "../protocol.js";
import {broadcastRoom, send} from "../registry.js";
import {updatePlayerState, towerUpgradeCostForRound, DEFAULT_REROLL_COST, readPlayerState} from "../matchState.js";
import {prisma} from "../../db/prisma.js";
import {MatchPlayer, CardType as PrismaCardType} from "@prisma/client";
import {applyCardEffect} from "../../match/effects.js";
import {placeCardAndMaybeMerge} from "../../match/boardUtils.js";
import {broadcastMatchState} from "../matchBroadcast.js";
import {scheduleRoundTimeout} from "../index.js";
import {debug, info, error} from "../../logging.js";
import {cardPlayedCounter} from '../../observability/metrics.js';
import {trace} from '@opentelemetry/api';

const matchRoom = (matchId: string) => `match:${matchId}`;

export async function handleBoardPlace(
    _ws: WebSocket,
    connId: string,
    msg: Extract<ClientMsg, { type: "BOARD_PLACE" }>,
    userId: string,
    sendMatchState: (connId: string, matchId: string) => Promise<void>,
): Promise<void> {
    const mp = await prisma.matchPlayer.findFirst({where: {matchId: msg.matchId, userId}});
    if (!mp) return;
    const requesterWs = _ws;
    const current = readPlayerState(mp as MatchPlayer);
    const {handIndex, boardIndex} = msg;
    if (
        handIndex < 0 ||
        handIndex >= (current.hand?.length ?? 0) ||
        boardIndex < 0 ||
        boardIndex >= current.board.length
    ) {
        return;
    }
    const cardId = current.hand[handIndex];
    if (!cardId) return;
    const def = await prisma.cardDefinition.findUnique({
        where: {id: cardId},
        select: {type: true, buffMultiplier: true, config: true, cost: true, baseHpBonus: true, baseDpsBonus: true}
    });
    const type = (def?.type ?? PrismaCardType.ATTACK) as PrismaCardType;
    const cost = (def?.cost ?? 0) as number;

    let mergeInfo: any = null;

    const mpAfter = await prisma.matchPlayer.findFirst({where: {matchId: msg.matchId, userId}});
    if (!mpAfter) return;
    const currentAfter = readPlayerState(mpAfter as MatchPlayer);
    if ((currentAfter.gold ?? 0) < cost) {
        broadcastRoom(matchRoom(msg.matchId), {
            type: "BOARD_PLACE_DENIED",
            matchId: msg.matchId,
            userId,
            handIndex: msg.handIndex,
            boardIndex: msg.boardIndex,
            cardId,
            reason: "NOT_ENOUGH_GOLD",
        });
        await sendMatchState(connId, msg.matchId);
        return;
    }

    try {
        const defAny = def as any;
        const isRefusal = (cardId === 'marry_refusal') || (defAny?.config?.target === 'marry_refusal');
        if (isRefusal) {
            // Special-case: marry_refusal acts as a spend-and-discard without board placement
            await updatePlayerState(msg.matchId, userId, (s) => {
                if (handIndex < 0 || handIndex >= s.hand.length) return s;
                if ((s.gold ?? 0) < cost) return s;
                s.gold -= cost;
                s.hand.splice(handIndex, 1);
                return s;
            });
            try {
                send(requesterWs as any, {
                    type: "BOARD_PLACE_ACK",
                    matchId: msg.matchId,
                    userId,
                    handIndex: msg.handIndex,
                    boardIndex: msg.boardIndex
                });
            } catch {
            }
            await broadcastMatchState(msg.matchId);
            return;
        }
    } catch (e) {
        error('[board] error handling marry_refusal special-case', {matchId: msg.matchId, userId, err: e});
    }
    const targetSlot = currentAfter.board[boardIndex];
    if (type !== PrismaCardType.BUFF && type !== PrismaCardType.ECONOMY) {
        if (targetSlot.cardId) {
            if (targetSlot.cardId !== cardId || (targetSlot.stackCount ?? 0) >= 3) {
                broadcastRoom(matchRoom(msg.matchId), {
                    type: "BOARD_PLACE_DENIED",
                    matchId: msg.matchId,
                    userId,
                    handIndex: msg.handIndex,
                    boardIndex: msg.boardIndex,
                    cardId,
                    reason: "INVALID_SLOT",
                });
                await sendMatchState(connId, msg.matchId);
                return;
            }
        }
    }
    if (type === PrismaCardType.BUFF || type === PrismaCardType.ECONOMY) {
        // BUFF / ECONOMY cards: apply immediate effect, move to discard
        await updatePlayerState(msg.matchId, userId, (s) => {
            if (handIndex < 0 || handIndex >= s.hand.length) return s;
            if ((s.gold ?? 0) < cost) return s;
            s.gold -= cost;
            applyCardEffect(s, {
                id: cardId,
                type: type,
                buffMultiplier: (def as any)?.buffMultiplier ?? null,
                config: (def as any)?.config ?? {},
            });
            s.hand.splice(handIndex, 1);
            if (!Array.isArray(s.discard)) s.discard = [];
            s.discard.push(cardId);
            return s;
        });
        try {
            const defAny = def as any;
            const isProposal = (cardId === 'marry_proposal') || (defAny?.config?.target === 'marry_proposal');
            if (isProposal) {
                try {
                    // marry_proposal: inject marry_refusal into opponents' decks (game design)
                    const opponents = await prisma.matchPlayer.findMany({where: {matchId: msg.matchId, NOT: {userId}}});
                    for (const opp of opponents) {
                        await updatePlayerState(msg.matchId, opp.userId, (s) => {
                            if (!Array.isArray(s.deck)) s.deck = [];
                            const idx = Math.floor(Math.random() * (s.deck.length + 1));
                            s.deck.splice(idx, 0, 'marry_refusal');
                            return s;
                        });
                    }
                    info('[board] spawned marry_refusal into opponents deck', {
                        matchId: msg.matchId,
                        from: userId,
                        opponents: opponents.map(o => o.userId)
                    });
                } catch (e) {
                    error('[board] failed to spawn marry_refusal', {matchId: msg.matchId, err: e});
                }
            }
        } catch (e) {
        }
        try {
            send(requesterWs as any, {
                type: "BOARD_PLACE_ACK",
                matchId: msg.matchId,
                userId,
                handIndex: msg.handIndex,
                boardIndex: msg.boardIndex
            });
        } catch {
        }
        await sendMatchState(connId, msg.matchId);
        return;
    }
    try {
        send(requesterWs as any, {
            type: "BOARD_PLACE_ACK",
            matchId: msg.matchId,
            userId,
            handIndex: msg.handIndex,
            boardIndex: msg.boardIndex
        });
    } catch {
    }

    // Regular attack/defense placement and possible merge
    await updatePlayerState(msg.matchId, userId, (s) => {
        if (
            handIndex < 0 ||
            handIndex >= s.hand.length ||
            boardIndex < 0 ||
            boardIndex >= s.board.length
        ) {
            return s;
        }
        if ((s.gold ?? 0) < cost) return s;
        s.gold -= cost;
        const beforeHandLen = s.hand.length;
        mergeInfo = placeCardAndMaybeMerge(s as any, handIndex, boardIndex, cardId);
        if (s.hand.length === beforeHandLen && s.hand[handIndex] === cardId) {
            s.hand.splice(handIndex, 1);
        }
        try {
            if (type === PrismaCardType.DEFENSE) {
                const defAny = (def as any) ?? {};
                const hpAdd = Number(defAny.baseHpBonus ?? 0) || 0;
                const dpsAdd = Number(defAny.baseDpsBonus ?? 0) || 0;
                if (hpAdd) {
                    s.towerHpMax = Math.max(0, Number(s.towerHpMax ?? s.towerHp ?? 0) + hpAdd);
                    s.towerHp = Math.min(s.towerHpMax, (Number(s.towerHp ?? 0) + hpAdd));
                }
                if (dpsAdd) {
                    s.towerDps = Math.max(0, Number(s.towerDps ?? 0) + dpsAdd);
                }
            }
        } catch {
        }
        if (!Array.isArray(s.discard)) s.discard = [];
        s.discard.push(cardId);
        return s;
    });
    try {
        if (mergeInfo && def && (def as any).type === PrismaCardType.DEFENSE) {
            const defAny = def as any;
            const hpAdd = Number(defAny.baseHpBonus ?? 0) || 0;
            const dpsAdd = Number(defAny.baseDpsBonus ?? 0) || 0;
            if (hpAdd || dpsAdd) {
                await updatePlayerState(msg.matchId, userId, (s) => {
                    if (hpAdd) {
                        s.towerHpMax = Math.max(0, Number(s.towerHpMax ?? s.towerHp ?? 0) + hpAdd);
                        s.towerHp = Math.min(s.towerHpMax, (Number(s.towerHp ?? 0) + hpAdd));
                    }
                    if (dpsAdd) {
                        s.towerDps = Math.max(0, Number(s.towerDps ?? 0) + dpsAdd);
                    }
                    return s;
                });
            }
        }
    } catch {
    }
    if (mergeInfo) {
        broadcastRoom(matchRoom(msg.matchId), {
            type: "BOARD_MERGE",
            matchId: msg.matchId,
            userId,
            cardId: mergeInfo.cardId,
            chosenIndex: mergeInfo.chosenIndex,
            clearedIndices: mergeInfo.clearedIndices,
            newMergeCount: mergeInfo.newMergeCount,
        });
    }
    try {
        try {
            cardPlayedCounter.inc({card_id: String(cardId), card_type: String(type)}, 1);
        } catch (e) {
        }
        try {
            const tracer = trace.getTracer('server');
            const span = tracer.startSpan('card.play', {
                attributes: {
                    'match.id': msg.matchId,
                    'card.id': cardId,
                    'player.id': userId
                }
            });
            span.end();
        } catch (e) {
        }
    } catch (e) {
    }
    await broadcastMatchState(msg.matchId);
}

export async function handleBoardSell(
    _ws: WebSocket,
    connId: string,
    msg: Extract<ClientMsg, { type: "BOARD_SELL" }>,
    userId: string,
    _sendMatchState: (connId: string, matchId: string) => Promise<void>,
): Promise<void> {
    const mpRow = await prisma.matchPlayer.findFirst({where: {matchId: msg.matchId, userId}});
    let sellCardId: string | null = null;
    if (mpRow) {
        const s = readPlayerState(mpRow as MatchPlayer);
        const slot = (s.board || [])[msg.boardIndex] ?? null;
        if (slot && slot.cardId) {
            sellCardId = slot.cardId;
        }
    }
    let defBonus: {
        baseHpBonus?: number | null;
        baseDpsBonus?: number | null;
        type?: string | null;
        cost?: number | null
    } | null = null;
    if (sellCardId) {
        defBonus = await prisma.cardDefinition.findUnique({
            where: {id: sellCardId},
            select: {baseHpBonus: true, baseDpsBonus: true, type: true, cost: true}
        }) as any;
    }
    const refundPerCard = Math.max(0, Math.floor(Number((defBonus as any)?.cost ?? 0) / 2));

    await updatePlayerState(msg.matchId, userId, (s) => {
        const {boardIndex} = msg;
        if (boardIndex < 0 || boardIndex >= s.board.length) {
            return s;
        }
        const slot = s.board[boardIndex];
        if (!slot.cardId) return s;
        s.gold += refundPerCard;
        try {
            const defType = (defBonus as any)?.type;
            if (defBonus && (defType === 'DEFENSE' || defType === PrismaCardType.DEFENSE)) {
                const hpReduce = Number(defBonus.baseHpBonus ?? 0) * (slot.stackCount || 1);
                const dpsReduce = Number(defBonus.baseDpsBonus ?? 0) * (slot.stackCount || 1);
                if (hpReduce) {
                    s.towerHpMax = Math.max(0, Number(s.towerHpMax ?? s.towerHp ?? 0) - hpReduce);
                    s.towerHp = Math.min(s.towerHpMax, Math.max(0, Number(s.towerHp ?? 0) - hpReduce));
                }
                if (dpsReduce) {
                    s.towerDps = Math.max(0, Number(s.towerDps ?? 0) - dpsReduce);
                }
            }
        } catch (e) {
        }
        slot.cardId = null;
        slot.stackCount = 0;
        return s;
    });

    try {
        send(_ws as any, {type: "BOARD_SELL_ACK", matchId: msg.matchId, userId, boardIndex: msg.boardIndex});
    } catch {
    }
    await broadcastMatchState(msg.matchId);
}

export async function handleTowerUpgrade(
    _ws: WebSocket,
    _connId: string,
    msg: Extract<ClientMsg, { type: "TOWER_UPGRADE" }>,
    userId: string,
    _sendMatchState: (connId: string, matchId: string) => Promise<void>,
): Promise<void> {
    let hpBonusFromCards = 0;
    let dpsBonusFromCards = 0;
    try {
        const mpRow = await prisma.matchPlayer.findFirst({where: {matchId: msg.matchId, userId}});
        if (mpRow) {
            const st = readPlayerState(mpRow as MatchPlayer);
            const boardCardIds = Array.from(new Set((st.board || []).map((s: any) => s.cardId).filter(Boolean)));
            if (boardCardIds.length > 0) {
                const defs = await prisma.cardDefinition.findMany({
                    where: {id: {in: boardCardIds as string[]}},
                    select: {id: true, config: true},
                });
                for (const d of defs) {
                    const upHp = (d as any).upgradeHpBonus ?? ((d as any).config?.upgradeHpBonus ?? 0);
                    const upDps = (d as any).upgradeDpsBonus ?? ((d as any).config?.upgradeDpsBonus ?? 0);
                    hpBonusFromCards += Number(upHp ?? 0);
                    dpsBonusFromCards += Number(upDps ?? 0);
                }
            }
        }
    } catch (e) {
        error('[round] failed to compute card-specific tower upgrade bonuses', {matchId: msg.matchId, userId, err: e});
    }
    Number((await import('../matchState.js')).MATCH_CONFIG.towerUpgradeHpBonus ?? 100);
    Number((await import('../matchState.js')).MATCH_CONFIG.towerUpgradeDpsBonus ?? 5);
    const persisted = await updatePlayerState(msg.matchId, userId, (s) => {
        const currentRound = s.round ?? 1;
        const lastUpgradeRound = s.lastTowerUpgradeRound ?? 0;
        const cost = towerUpgradeCostForRound(currentRound, lastUpgradeRound);
        debug('[round] tower upgrade attempt', {
            matchId: msg.matchId,
            userId,
            currentRound,
            lastUpgradeRound,
            cost,
            gold: s.gold
        });
        if (s.gold < cost) {
            debug('[round] tower upgrade denied - insufficient gold', {
                matchId: msg.matchId,
                userId,
                cost,
                gold: s.gold
            });
            return s;
        }
        s.gold -= cost;
        s.towerLevel = (s.towerLevel ?? 1) + 1;
        s.rerollCost = DEFAULT_REROLL_COST;
        s.lastTowerUpgradeRound = currentRound;
        info('[round] tower upgraded', {
            matchId: msg.matchId,
            userId,
            newTowerLevel: s.towerLevel,
            lastTowerUpgradeRound: s.lastTowerUpgradeRound,
            towerHpMax: s.towerHpMax,
            towerHp: s.towerHp,
            towerDps: s.towerDps
        });
        return s;
    });
    try {
        if (persisted) {
            debug('[round] persisted after tower upgrade', {
                matchId: msg.matchId,
                userId,
                persistedLastUpgrade: persisted.lastTowerUpgradeRound,
                persistedRound: persisted.round,
                persistedGold: persisted.gold
            });
        } else {
            debug('[round] tower upgrade did not produce persisted change (maybe denied)', {
                matchId: msg.matchId,
                userId
            });
        }
    } catch (err) {
        error('[round] failed to log persisted state after tower upgrade', err);
    }
    await broadcastMatchState(msg.matchId);
    try {
        await scheduleRoundTimeout(msg.matchId);
    } catch (err) {
        error('[round] failed to reschedule round timeout after tower upgrade', err);
    }
}

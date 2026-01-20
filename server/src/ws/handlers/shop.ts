/**
 * shop.ts
 *
 * WebSocket handlers for shop interactions: rerolling offers and buying cards.
 * These perform validation against player gold / shop contents and update
 * player state via `updatePlayerState`.
 */

import type {WebSocket} from "ws";
import type {ClientMsg} from "../protocol.js";
import {
    updatePlayerState,
    randomShopWeighted,
    readPlayerState,
    getShopOfferCount,
    DEFAULT_REROLL_COST
} from "../matchState.js";
import {prisma} from "../../db/prisma.js";
import {MatchPlayer} from "@prisma/client";
import {broadcastRoom} from "../registry.js";

export async function handleShopReroll(
    _ws: WebSocket,
    _connId: string,
    msg: Extract<ClientMsg, { type: "SHOP_REROLL" }>,
    userId: string,
    sendMatchState: (connId: string, matchId: string) => Promise<void>,
): Promise<void> {
    const mp = await prisma.matchPlayer.findFirst({
        where: {matchId: msg.matchId, userId},
    });
    if (!mp) {
        return;
    }
    const state = readPlayerState(mp as MatchPlayer);
    const newShop = await randomShopWeighted(getShopOfferCount(state.towerLevel), state.towerLevel);
    await updatePlayerState(msg.matchId, userId, (s) => {
        const cost = s.rerollCost ?? DEFAULT_REROLL_COST;
        if ((s.gold ?? 0) < cost) return s;
        s.gold -= cost;
        s.shop = newShop;
        return s;
    });
    await sendMatchState(_connId, msg.matchId);
}

export async function handleShopBuy(
    _ws: WebSocket,
    _connId: string,
    msg: Extract<ClientMsg, { type: "SHOP_BUY" }>,
    userId: string,
    sendMatchState: (connId: string, matchId: string) => Promise<void>,
): Promise<void> {
    const card = await prisma.cardDefinition.findUnique({
        where: {id: msg.cardId},
        select: {cost: true},
    });
    if (!card) {
        return;
    }
    const cost = card.cost ?? 0;
    const mp = await prisma.matchPlayer.findFirst({where: {matchId: msg.matchId, userId}});
    if (!mp) return;
    const state = readPlayerState(mp as MatchPlayer);
    if ((state.gold ?? 0) < cost) {
        broadcastRoom(`match:${msg.matchId}`, {
            type: "SHOP_BUY_DENIED",
            matchId: msg.matchId,
            userId,
            cardId: msg.cardId,
            reason: "NOT_ENOUGH_GOLD",
        });
        await sendMatchState(_connId, msg.matchId);
        return;
    }

    await updatePlayerState(msg.matchId, userId, (s) => {
        const {cardId} = msg;
        if (!Array.isArray(s.shop) || !s.shop.includes(cardId)) return s;
        if ((s.gold ?? 0) < cost) return s;
        s.gold -= cost;
        if (!Array.isArray(s.deck)) s.deck = [];
        s.deck.unshift(cardId);
        const idx = s.shop.findIndex((id) => id === cardId);
        if (idx >= 0) {
            s.shop.splice(idx, 1);
        }
        return s;
    });
    await sendMatchState(_connId, msg.matchId);
}

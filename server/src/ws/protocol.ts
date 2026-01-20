/**
 * protocol.ts
 *
 * Zod schemas describing the WebSocket client and server protocol. These
 * definitions are used to validate incoming messages and to provide typed
 * message structures throughout the server.
 */

import {z} from "zod";
import {
    type MatchPhase,
    type MatchPlayerState,
    type MatchSummaryPlayerView,
} from "../../../shared/protocol/types/match.js";

export const BaseMsg = z.object({v: z.number().default(1), type: z.string()});

export const PingMsg = BaseMsg.extend({type: z.literal("PING")});

export const AuthMsg = BaseMsg.extend({
    type: z.literal("AUTH"),
    token: z.string().min(1),
});

export const MatchJoinMsg = BaseMsg.extend({
    type: z.literal("MATCH_JOIN"),
    matchId: z.string().min(1),
});

export const ChatSendMsg = BaseMsg.extend({
    type: z.literal("CHAT_SEND"),
    matchId: z.string().min(1),
    text: z.string().min(1).max(500),
});

export const MatchmakingStartMsg = BaseMsg.extend({
    type: z.literal("MATCHMAKING_START"),
    deckId: z.string().optional(),
});

export const MatchmakingCancelMsg = BaseMsg.extend({
    type: z.literal("MATCHMAKING_CANCEL"),
});

export const MatchReadyConfirmMsg = BaseMsg.extend({
    type: z.literal("MATCH_READY_CONFIRM"),
    matchId: z.string(),
});

export const MatchFoundMsg = BaseMsg.extend({
    type: z.literal("MATCH_FOUND"),
    matchId: z.string().min(1),
});

export const MatchEndRoundMsg = BaseMsg.extend({
    type: z.literal("MATCH_END_ROUND"),
    matchId: z.string().min(1),
});

export const BattleDoneMsg = BaseMsg.extend({
    type: z.literal("BATTLE_DONE"),
    matchId: z.string().min(1),
    round: z.number().int().nonnegative(),
});

export const MatchForfeitMsg = BaseMsg.extend({
    type: z.literal("MATCH_FORFEIT"),
    matchId: z.string().min(1),
});

export const ShopRerollMsg = BaseMsg.extend({
    type: z.literal("SHOP_REROLL"),
    matchId: z.string().min(1),
});

export const ShopBuyMsg = BaseMsg.extend({
    type: z.literal("SHOP_BUY"),
    matchId: z.string().min(1),
    cardId: z.string().min(1),
});

export const BoardPlaceMsg = BaseMsg.extend({
    type: z.literal("BOARD_PLACE"),
    matchId: z.string().min(1),
    handIndex: z.number().int().nonnegative(),
    boardIndex: z.number().int().nonnegative(),
});

export const BoardSellMsg = BaseMsg.extend({
    type: z.literal("BOARD_SELL"),
    matchId: z.string().min(1),
    boardIndex: z.number().int().nonnegative(),
});

export const TowerUpgradeMsg = BaseMsg.extend({
    type: z.literal("TOWER_UPGRADE"),
    matchId: z.string().min(1),
});

export const MatchStateRequestMsg = BaseMsg.extend({
    type: z.literal("MATCH_STATE_REQUEST"),
    matchId: z.string().min(1),
});

export const LobbySubscribeMsg = BaseMsg.extend({
    type: z.literal('LOBBY_SUBSCRIBE'),
    lobbyId: z.string().min(1),
});

export const LobbySetDeckMsg = BaseMsg.extend({
    type: z.literal('LOBBY_SET_DECK'),
    lobbyId: z.string().min(1),
    deckId: z.string().min(1),
});

export const LobbySetReadyMsg = BaseMsg.extend({
    type: z.literal('LOBBY_SET_READY'),
    lobbyId: z.string().min(1),
    isReady: z.boolean(),
});

export const ChatHistoryRequestMsg = BaseMsg.extend({
    type: z.literal("CHAT_HISTORY_REQUEST"),
    matchId: z.string().min(1),
});

export const ClientMsg = z.discriminatedUnion("type", [
    PingMsg,
    AuthMsg,
    MatchJoinMsg,
    ChatSendMsg,
    ChatHistoryRequestMsg,
    MatchmakingStartMsg,
    MatchmakingCancelMsg,
    MatchReadyConfirmMsg,
    MatchEndRoundMsg,
    BattleDoneMsg,
    MatchForfeitMsg,
    ShopRerollMsg,
    ShopBuyMsg,
    BoardPlaceMsg,
    BoardSellMsg,
    TowerUpgradeMsg,
    MatchStateRequestMsg,
    LobbySubscribeMsg,
    LobbySetDeckMsg,
    LobbySetReadyMsg,
]);


export const MatchStateServerMsg = BaseMsg.extend({
    type: z.literal("MATCH_STATE"),
    matchId: z.string().min(1),
    phase: z.custom<MatchPhase>(),
    round: z.number().int().nonnegative(),
    self: z.object({}).passthrough() as unknown as z.ZodType<MatchPlayerState>,
    players: z
        .array(
            z.object({}).passthrough() as unknown as z.ZodType<MatchSummaryPlayerView>,
        )
        .default([]),
});

export const LobbyStateServerMsg = BaseMsg.extend({
    type: z.literal('LOBBY_STATE'),
    lobby: z.object({}).passthrough().optional(),
});

export const MatchForfeitInfoServerMsg = BaseMsg.extend({
    type: z.literal("MATCH_FORFEIT_INFO"),
    matchId: z.string().min(1),
    userId: z.string().min(1),
});

export const ShopBuyDeniedServerMsg = BaseMsg.extend({
    type: z.literal("SHOP_BUY_DENIED"),
    matchId: z.string().min(1),
    userId: z.string().min(1),
    cardId: z.string().min(1),
    reason: z.string(),
});

export const BoardPlaceDeniedServerMsg = BaseMsg.extend({
    type: z.literal("BOARD_PLACE_DENIED"),
    matchId: z.string().min(1),
    userId: z.string().min(1),
    handIndex: z.number().int().nonnegative(),
    boardIndex: z.number().int().nonnegative(),
    cardId: z.string().min(1),
    reason: z.string(),
});

export const BoardMergeServerMsg = BaseMsg.extend({
    type: z.literal("BOARD_MERGE"),
    matchId: z.string().min(1),
    userId: z.string().min(1),
    cardId: z.string().min(1),
    chosenIndex: z.number().int().nonnegative(),
    clearedIndices: z.array(z.number().int().nonnegative()).max(2),
    newMergeCount: z.number().int().nonnegative(),
});

export const ServerMsg = z.discriminatedUnion("type", [
    PingMsg,
    MatchFoundMsg,
    MatchStateServerMsg,
    MatchForfeitInfoServerMsg,
    z.object({
        type: z.literal("MATCH_ROUND_END"),
        v: z.number(),
        matchId: z.string(),
        round: z.number(),
        phase: z.string().optional(),
    }),
    ShopBuyDeniedServerMsg,
    BoardPlaceDeniedServerMsg,
    BoardMergeServerMsg,
    z.object({
        type: z.literal("MATCH_BATTLE_UPDATE"),
        v: z.number(),
        matchId: z.string(),
        round: z.number(),
        events: z.array(z.object({}).passthrough()).default([]),
    }),
    LobbyStateServerMsg,
]);

export type ClientMsg = z.infer<typeof ClientMsg>;
export type ServerMsg = z.infer<typeof ServerMsg>;

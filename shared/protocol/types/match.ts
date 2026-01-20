/**
 * match.ts
 *
 * Central shared types for match state and WebSocket messages. These types are
 * kept intentionally lean and serializable so they can be used by both server
 * and client code. They describe per-player state, per-match snapshots, and
 * the WebSocket messages used to communicate state, replays and battle events.
 */

export type MatchPhase = "lobby" | "shop" | "combat" | "finished";

export interface MatchBoardSlot {
    cardId: string | null;
    stackCount: number;
}

export interface PlayerZones {
    deck: string[];
    hand: string[];
    discard: string[];
    board: MatchBoardSlot[];
    shop: string[];
}

export interface MatchPlayerState extends PlayerZones {
    // Optional meta provided when serializing snapshots for a specific user
    userId?: string;
    username?: string | null;
    seat?: number;
    // Economic and action-related state
    gold: number;
    rerollCost: number;
    towerUpgradeCost?: number;
    // Tower stats
    towerLevel: number;
    towerHp: number;
    towerHpMax: number;
    towerDps: number;
    // Match progression
    round: number;
    totalDamageOut: number;
    totalDamageIn: number;
    pendingExtraDraws?: number;
    goldPerRound?: number;
    maxGold?: number;
    phase?: MatchPhase;
    // Server-side UTC-millisecond timestamp when the current round will expire
    roundTimerTs?: number | null;
    // Computed client-friendly time left (ms) based on server timestamp
    roundTimeLeftMs?: number | null;
    towerColor?: "red" | "blue";
    // Last round index when the tower was upgraded (used to compute costs)
    lastTowerUpgradeRound: number;
}

export interface MatchSummaryPlayerView {
    userId: string;
    username?: string | null;
    seat?: number;
    towerLevel?: number;
    towerHp: number;
    towerHpMax?: number;
    totalDamageOut: number;
    totalDamageIn: number;
    towerColor?: "red" | "blue";
}

export interface MatchStateSnapshot {
    matchId: string;
    phase: MatchPhase;
    round: number;
    self: MatchPlayerState;
    players: MatchSummaryPlayerView[];
}

export interface WsMatchStateMsg extends MatchStateSnapshot {
    type: "MATCH_STATE";
    v: number;
}

export interface WsMatchForfeitInfoMsg {
    type: "MATCH_FORFEIT_INFO";
    v: number;
    matchId: string;
    userId: string;
}

export interface WsMatchRoundEndMsg {
    type: "MATCH_ROUND_END";
    v: number;
    matchId: string;
    round: number;
    phase?: MatchPhase; 
}

export interface BattleEvent {
    type: "damage";
    // Userids of the actor and target
    fromUserId: string;
    fromUsername?: string | null;
    toUserId: string;
    toUsername?: string | null;
    amount: number;
    atMsOffset: number;
    // Optional target scoping for buffs/effects
    target?: 'units' | 'tower';
}

export interface UnitInfo {
    id: string; 
    ownerUserId?: string | null; 
    cardId?: string | null;
    type: 'ogre' | 'goblin' | string;
    hp: number;
    maxHp: number;
    dmgPerTick?: number;
    approach: number; 
    color?: string;
}

export interface ShotsPerTick {
    aShots: number;
    bShots: number;
}

export interface PerTickSummaryUserEntry {
    userId: string;
    alive: number;
    reached: number;
    dead: number;
    dmgToTower: number;
}

export interface PerTickSummaryEntry {
    tick: number;
    entries: PerTickSummaryUserEntry[];
}

export interface WsBattleUpdateMsg {
    type: "MATCH_BATTLE_UPDATE";
    v: number;
    matchId: string;
    round: number;
    events: BattleEvent[];
    ticksToReach?: number;
    initialUnits?: UnitInfo[];
    shotsPerTick?: ShotsPerTick[];
    perTickSummary?: PerTickSummaryEntry[];
    postHp?: Record<string, number> | null;
}

export interface WsShopBuyDeniedMsg {
    type: "SHOP_BUY_DENIED";
    v: number;
    matchId: string;
    userId: string;
    cardId: string;
    reason: string; 
}

export interface WsBoardPlaceDeniedMsg {
    type: "BOARD_PLACE_DENIED";
    v: number;
    matchId: string;
    userId: string;
    handIndex: number;
    boardIndex: number;
    cardId: string;
    reason: string; 
}

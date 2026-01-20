/**
 * store.ts
 *
 * Simple in-memory client state shape used across the UI. Not reactive — the
 * application mutates `state` directly and components read from it.
 */

export type AppState = { guid: string; health?: any };
export type ChatState = {
    scope: "match" | "lobby";
    id: string;
    matchId: string | null;
    messages: {
        userId: string;
        username?: string | null;
        text: string;
        ts: number;
    }[];
    unreadCount: number;
    isOpen: boolean;
};

export type MatchState = {
    matchId: string | null;
    phase: "lobby" | "shop" | "combat" | "finished";
    round: number;
    towerLevel: number;
    towerHp: number;
    towerHpMax: number;
    towerDps: number;
    gold: number;
    rerollCost: number;
    towerUpgradeCost?: number;
    towerColor?: "red" | "blue";
    totalDamageOut: number;
    totalDamageIn: number;
    deckIds: string[];
    handIds: string[];
    discardIds: string[];
    boardSlots: { cardId: string | null; stackCount: number }[];
    shopIds: string[];
    roundTimerTs?: number | null;
    playersSummary?: {
        userId: string;
        username?: string | null;
        seat?: number;
        towerColor?: "red" | "blue";
        towerLevel?: number;
        towerHp: number;
        towerHpMax?: number;
        totalDamageOut: number;
        totalDamageIn: number;
        eliminationReason?: string | undefined;
    }[];
    eliminationReason?: string | undefined;
};

export function uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export const state = {
    appState: {} as AppState,
    guid: uuid(),
    health: null as any,
    chat: {
        scope: "match" as "match" | "lobby",
        id: "",
        matchId: null as string | null,
        messages: [] as ChatState["messages"],
        unreadCount: 0,
        isOpen: false,
    } as ChatState,
    matchId: null as string | null,
    userId: "",
    // new flag: indicates the user is currently navigating/participating in match flow
    isInMatchFlow: false as boolean,
    // explicit UI markers to replace DOM dataset flags
    isSearching: false as boolean,
    isStarting: false as boolean,
    matchState: {
        matchId: null as string | null,
        phase: null as "lobby" | "shop" | "combat" | "finished" | null,
        round: null as number | null,
        towerLevel: null as number | null,
        towerHp: null as number | null,
        towerHpMax: null as number | null,
        towerDps: null as number | null,
        gold: null as number | null,
        rerollCost: null as number | null,
        towerUpgradeCost: undefined,
        towerColor: undefined,
        totalDamageOut: null as number | null,
        totalDamageIn: null as number | null,
        deckIds: [],
        handIds: [],
        discardIds: [],
        boardSlots: Array.from({length: 7}).map(() => ({cardId: null as string | null, stackCount: 0})),
        shopIds: [],
        roundTimerTs: null,
        playersSummary: [],
        eliminationReason: undefined,
    } as MatchState,
    battleLog: [] as {
        matchId: string;
        round: number;
        attackerLabel: string;
        targetLabel: string;
        amount: number;
        ts: number;
    }[],
};

const defaultMatchState: MatchState = {
    matchId: null,
    phase: null as any,
    round: null as any,
    towerLevel: null as any,
    towerHp: null as any,
    towerHpMax: null as any,
    towerDps: null as any,
    gold: null as any,
    rerollCost: null as any,
    towerUpgradeCost: undefined,
    towerColor: undefined,
    totalDamageOut: null as any,
    totalDamageIn: null as any,
    deckIds: [],
    handIds: [],
    discardIds: [],
    boardSlots: Array.from({length: 7}).map(() => ({cardId: null as string | null, stackCount: 0})),
    shopIds: [],
    roundTimerTs: null,
    playersSummary: [],
    eliminationReason: undefined,
} as MatchState;

export function resetMatchState() {
    try {
        (state as any).matchState = JSON.parse(JSON.stringify(defaultMatchState));
    } catch (e) {
        try {
            (state as any).matchState = defaultMatchState as any;
        } catch (err) {
        }
    }
}

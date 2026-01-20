/**
 * match-ws-handler.ts
 *
 * Centralized handlers for incoming websocket messages related to match
 * state, round updates and battle events. Hooks into the global EventBus and
 * updates `state.matchState` as well as dispatching UI events.
 */

import {bus} from "./EventBus";
import {type MatchState, state, resetMatchState} from "./store";
import {debug, error} from "./log";
import type {
    WsBattleUpdateMsg,
    WsMatchForfeitInfoMsg,
    WsMatchRoundEndMsg,
    WsMatchStateMsg,
} from "../../../shared/protocol/types/match.js";
import {scheduleBattleAnimations} from "../components/battle-scheduler";
import {setActiveMatch} from "./ws";

function normalizePhase(raw: any): MatchState["phase"] {
    if (raw === "finished") return "finished";
    if (raw === "shop") return "shop";
    if (raw === "combat") return "combat";
    return "lobby";
}

/** Install handlers that respond to raw `ws:msg` events on the EventBus. */
export function initMatchWsHandlers() {
    bus.on("ws:msg", (m: any) => {
        if (!m || typeof m !== "object") return;
        if (m.type === "ERROR") {
            try {
                const code = m.code ?? "";
                debug('[client] received ERROR from server', {code, msg: m});
                const clearMatchLocally = () => {
                    try {
                        setActiveMatch(null);
                    } catch {
                    }
                    try {
                        state.matchId = null as any;
                    } catch {
                    }
                    try {
                        resetMatchState();
                    } catch {
                    }
                    try {
                        // ensure match-flow flags are cleared so UI can navigate normally
                        (state as any).isInMatchFlow = false;
                        (state as any).isSearching = false;
                        (state as any).isStarting = false;
                    } catch {
                    }
                    try {
                        const root = document.getElementById('screen-root') as HTMLElement | null;
                        if (root) {
                            try {
                                delete (root as any).dataset.inSearching;
                            } catch {
                            }
                            try {
                                delete (root as any).dataset.inStarting;
                            } catch {
                            }
                        }
                    } catch {
                    }
                };

                // If the server says we're not a participant, the persisted matchId is stale.
                // Clear it so refreshes don't keep trying to rejoin a match we aren't in.
                if (code === 'NOT_A_PLAYER') {
                    clearMatchLocally();
                    // Prefer going home; if the user is still in a lobby, restoreSession will reopen it.
                    try {
                        document.dispatchEvent(new CustomEvent('nav:home'));
                    } catch {
                    }
                    return;
                }

                // Match is not usable (finished/cancelled/stale or server not ready). Clean up aggressively.
                if (code === 'MATCH_NOT_AVAILABLE' || code === 'MATCH_NOT_RUNNING' || code === 'MATCH_NOT_FOUND') {
                    clearMatchLocally();

                    // If we have an active lobby context, prefer returning to the lobby screen.
                    // (restoreSession() will also reconcile /api/me in background.)
                    try {
                        if ((state as any).lobbyId) {
                            document.dispatchEvent(new CustomEvent('nav:lobby'));
                            return;
                        }
                    } catch {
                    }
                    // Fallback: navigate home
                    try {
                        if (window.history && typeof window.history.pushState === 'function') {
                            window.history.pushState({}, '', '/');
                        }
                    } catch {
                    }
                    try {
                        document.dispatchEvent(new CustomEvent('nav:home'));
                    } catch {
                    }
                    return;
                }
            } catch (err) { /* ignore */
            }
            return;
        }

        if (m.type === "MATCH_STATE") {
            const msg = m as WsMatchStateMsg;
            const self = msg.self ?? {};
            const matchId = (msg.matchId as string | undefined) ?? null;
            const phase = normalizePhase(msg.phase);

            debug("[client] MATCH_STATE", {
                matchId,
                phase,
                round: self.round,
                roundTimerTs: self.roundTimerTs,
                userId: state.userId,
                guid: state.guid,
            });

            const deck = Array.isArray(self.deck) ? self.deck : [];
            const hand = Array.isArray(self.hand) ? self.hand : [];
            const discard = Array.isArray(self.discard) ? self.discard : [];
            const boardRaw = Array.isArray(self.board) ? self.board : [];
            const shop = Array.isArray(self.shop) ? self.shop : [];

            state.matchId = matchId;
            state.matchState = {
                matchId,
                phase,
                round: Number(msg.round ?? self.round ?? 1),
                towerLevel: Number(self.towerLevel ?? 1),
                towerHp: Number(self.towerHp ?? 1000),
                towerHpMax: Number(self.towerHpMax ?? 1000),
                towerDps: Number(self.towerDps ?? 10),
                gold: Number(self.gold ?? 0),
                rerollCost: Number(self.rerollCost ?? 2),
                towerUpgradeCost:
                    typeof (self as any).towerUpgradeCost === "number"
                        ? (self as any).towerUpgradeCost
                        : undefined,
                towerColor: (self as any).towerColor as "red" | "blue" | undefined,
                totalDamageOut: Number(self.totalDamageOut ?? 0),
                totalDamageIn: Number(self.totalDamageIn ?? 0),
                deckIds: deck.map((id: any) => String(id)),
                handIds: hand.map((id: any) => String(id)),
                discardIds: discard.map((id: any) => String(id)),
                boardSlots: Array.from({length: 7}).map((_, i) => {
                    const raw = boardRaw[i] ?? {cardId: null, stackCount: 0};
                    return {
                        cardId: raw?.cardId ? String(raw.cardId) : null,
                        stackCount: Number(raw?.stackCount ?? 0),
                    };
                }),
                shopIds: shop.map((id: any) => String(id)),
                roundTimerTs:
                    typeof (self as any).roundTimeLeftMs === 'number' && (self as any).roundTimeLeftMs !== null
                        ? Date.now() + Number((self as any).roundTimeLeftMs)
                        : typeof self.roundTimerTs === "number"
                            ? self.roundTimerTs
                            : null,
                playersSummary: Array.isArray(msg.players)
                    ? msg.players.map((p) => ({
                        userId: String(p.userId),
                        username: p.username ?? null,
                        seat: typeof p.seat === "number" ? p.seat : undefined,
                        towerColor: p.towerColor as "red" | "blue" | undefined,
                        towerLevel: typeof p.towerLevel === "number" ? p.towerLevel : undefined,
                        towerHp: Number(p.towerHp ?? 0),
                        towerHpMax: typeof (p as any).towerHpMax === "number"
                            ? (p as any).towerHpMax
                            : undefined,
                        totalDamageOut: Number(p.totalDamageOut ?? 0),
                        totalDamageIn: Number(p.totalDamageIn ?? 0),
                        eliminationReason: (p as any)?.state?.eliminationReason ?? undefined,
                    }))
                    : [],
                eliminationReason: (self as any)?.eliminationReason ?? undefined,
            };

            debug("[client] MATCH_STATE players colors", {
                matchId,
                userId: state.userId,
                players: (msg.players || []).map((p) => ({
                    userId: p.userId,
                    username: p.username,
                    seat: p.seat,
                    towerColor: p.towerColor,
                })),
            });

            bus.emit("match:state", {match: state.matchState});
            try {
                if (phase === 'finished') {
                    try {
                        setActiveMatch(null);
                    } catch (e) {
                    }
                }
            } catch (e) {
            }
            return;
        }

        if (m.type === "MATCH_FORFEIT_INFO") {
            const msg = m as WsMatchForfeitInfoMsg;
            bus.emit("match:forfeit-info", {
                matchId: msg.matchId as string | undefined,
                userId: msg.userId as string | undefined,
            });
            return;
        }

        if (m.type === "MATCH_ROUND_END") {
            const msg = m as WsMatchRoundEndMsg;
            debug("[client] MATCH_ROUND_END", msg);
            bus.emit("match:round-end", {
                matchId: msg.matchId,
                round: msg.round,
                phase: msg.phase,
            });
            return;
        }

        if (m.type === "BOARD_MERGE") {
            bus.emit('match:board-merge', {
                matchId: m.matchId as string,
                userId: m.userId as string,
                cardId: m.cardId as string,
                chosenIndex: (m as any).chosenIndex as number,
                clearedIndices: (m as any).clearedIndices as number[],
                newMergeCount: (m as any).newMergeCount as number,
            });
            return;
        }

        if (m.type === "MATCH_BATTLE_UPDATE") {
            const msg = m as WsBattleUpdateMsg;
            debug("[client] MATCH_BATTLE_UPDATE", msg);
            bus.emit("match:battle-update", msg);
            try {
                const events = Array.isArray(msg.events) ? msg.events : [];
                try {
                    (state as any).lastBattleEvents = events.slice();
                } catch {
                }
                scheduleBattleAnimations(null, String(msg.matchId ?? ""), Number(msg.round ?? 0) || 0, events, msg.ticksToReach, (msg as any).initialUnits, (msg as any).shotsPerTick, (msg as any).perTickSummary);
            } catch (err) {
                error('[client] failed to schedule battle animations', err);
            }
            // If server included postHp mapping, apply it to local state so
            // the VS bar and summary reflect immediate HP changes.
            try {
                if (msg.postHp && typeof msg.postHp === 'object') {
                    const map = msg.postHp as Record<string, number>;
                    // If our own userId is present, update top-level matchState
                    state.matchState.towerHp = map[state.userId ?? ''];
                    // Update players summary
                    if (Array.isArray(state.matchState.playersSummary)) {
                        state.matchState.playersSummary = state.matchState.playersSummary.map(p => ({
                            ...p,
                            towerHp: typeof map[p.userId] === 'number' ? map[p.userId] : p.towerHp
                        }));
                    }
                }
            } catch (err) {
                error('[client] failed to apply postHp from MATCH_BATTLE_UPDATE', err);
            }
            return;
        }

        // Handle server denial messages
        if (m.type === "SHOP_BUY_DENIED") {
            bus.emit("match:shop-buy-denied", {
                matchId: m.matchId as string,
                userId: m.userId as string,
                cardId: m.cardId as string,
                reason: (m as any).reason as string,
            });
            return;
        }

        if (m.type === "BOARD_PLACE_DENIED") {
            bus.emit("match:board-place-denied", {
                matchId: m.matchId as string,
                userId: m.userId as string,
                handIndex: (m as any).handIndex as number,
                boardIndex: (m as any).boardIndex as number,
                cardId: m.cardId as string,
                reason: (m as any).reason as string,
            });
            return;
        }
    });
}

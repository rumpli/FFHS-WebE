/**
 * ws.ts
 *
 * WebSocket helper used to send typed messages to the game server and manage
 * a small reconnect/backoff and queueing layer for requests sent while the
 * connection is not open. Also exposes convenience wrappers for common
 * game actions (matchJoin, shopBuy, chatSend, ...).
 */

import {bus} from "./EventBus";
import {debug} from "./log";

const WS_URL = (window as any).__CFG__.WS_URL;

let ws: WebSocket | null = null;
let connState: "connected" | "connecting" | "closed" | "error" = "closed";

let retryTimer: any = null;
let retryMs = 500;

let lastAuthToken: string | null = null;
let lastMatchId: string | null = null;

const outbox: string[] = [];

const ACTIVE_MATCH_KEY = "towerlords_active_match";

function setState(s: typeof connState) {
    if (connState === s) return;
    connState = s;
    bus.emit("ws:status", {state: connState});
}

export function getWsState() {
    return connState;
}

/**
 * Persist the matchId we want to rejoin if reconnecting.
 */
export function setActiveMatch(matchId: string | null) {
    lastMatchId = matchId;
    try {
        if (typeof matchId === 'string' && matchId.length > 0) {
            localStorage.setItem(ACTIVE_MATCH_KEY, matchId);
        } else {
            localStorage.removeItem(ACTIVE_MATCH_KEY);
        }
    } catch {
    }
}

export function getActiveMatch(): string | null {
    try {
        return localStorage.getItem(ACTIVE_MATCH_KEY);
    } catch {
        return null;
    }
}

export function ensureConnected() {
    if (connState === "connected" || connState === "connecting") return;

    setState("connecting");
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        retryMs = 500;
        setState("connected");
        try {
            debug('[ws] connected to', WS_URL);
        } catch (e) {
        }
        if (lastAuthToken) {
            ws!.send(JSON.stringify({v: 1, type: "AUTH", token: lastAuthToken}));
        }

        if (lastMatchId) {
            let queuedJoin = false;
            try {
                for (const raw of outbox) {
                    try {
                        const msg = JSON.parse(raw);
                        if (msg && msg.type === 'MATCH_JOIN' && String(msg.matchId) === String(lastMatchId)) {
                            queuedJoin = true;
                            break;
                        }
                    } catch (e) {
                    }
                }
            } catch (e) {
            }
            if (!queuedJoin) {
                ws!.send(JSON.stringify({v: 1, type: "MATCH_JOIN", matchId: lastMatchId}));
            }
        }

        while (outbox.length && ws) ws.send(outbox.shift()!);

        ws?.send(JSON.stringify({v: 1, type: "PING"}));
    };

    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            bus.emit("ws:msg", msg);
        } catch {
        }
    };

    ws.onerror = () => setState("error");

    ws.onclose = () => {
        setState("closed");

        if (retryTimer) return;

        retryTimer = setTimeout(() => {
            retryTimer = null;
            retryMs = Math.min(15000, retryMs * 2);
            ensureConnected();
        }, retryMs);

        bus.emit("ws:retryIn", {ms: retryMs});
    };
}

export function send(type: string, payload: any = {}) {
    const msg = JSON.stringify({v: 1, type, ...payload});

    try {
        debug('[ws] send() connState=', connState, 'type=', type, 'payload=', payload);
    } catch (e) {
    }

    if (connState !== "connected" || !ws) {
        try {
            debug('[ws] not connected - queueing message', type);
        } catch (e) {
        }
        if (type === 'MATCH_JOIN' && payload && typeof payload.matchId !== 'undefined') {
            const mid = String(payload.matchId);
            let exists = false;
            try {
                for (const raw of outbox) {
                    try {
                        const m = JSON.parse(raw);
                        if (m && m.type === 'MATCH_JOIN' && String(m.matchId) === mid) {
                            exists = true;
                            break;
                        }
                    } catch (e) {
                    }
                }
            } catch (e) {
            }
            if (!exists) outbox.push(msg);
        } else {
            outbox.push(msg);
        }
        ensureConnected();
        return;
    }

    try {
        ws.send(msg);
        try {
            debug('[ws] message sent', type);
        } catch (e) {
        }
    } catch {
        try {
            debug('[ws] send failed - queuing', type);
        } catch (e) {
        }
        if (type === 'MATCH_JOIN' && payload && typeof payload.matchId !== 'undefined') {
            const mid = String(payload.matchId);
            let exists = false;
            try {
                for (const raw of outbox) {
                    try {
                        const m = JSON.parse(raw);
                        if (m && m.type === 'MATCH_JOIN' && String(m.matchId) === mid) {
                            exists = true;
                            break;
                        }
                    } catch (e) {
                    }
                }
            } catch (e) {
            }
            if (!exists) outbox.push(msg);
        } else {
            outbox.push(msg);
        }
    }
}

export function authenticate(token: string) {
    lastAuthToken = token;
}

export function matchmakingStart(deckId?: string) {
    send("MATCHMAKING_START", {deckId});
}

export function cancelMatchmaking() {
    send("MATCHMAKING_CANCEL", {});
}

export function matchJoin(matchId: string) {
    setActiveMatch(matchId);
    send("MATCH_JOIN", {matchId});
}

export function matchReadyConfirm(matchId: string) {
    send("MATCH_READY_CONFIRM", {matchId});
}

export function matchEndRound(matchId: string) {
    send("MATCH_END_ROUND", {matchId});
}

export function matchForfeit(matchId: string) {
    send("MATCH_FORFEIT", {matchId});
}

export function towerUpgrade(matchId: string) {
    send("TOWER_UPGRADE", {matchId});
}

export function shopReroll(matchId: string) {
    send("SHOP_REROLL", {matchId});
}

export function shopBuy(matchId: string, cardId: string) {
    send("SHOP_BUY", {matchId, cardId});
}

export function boardPlace(matchId: string, handIndex: number, boardIndex: number) {
    send("BOARD_PLACE", {matchId, handIndex, boardIndex});
}

export function boardSell(matchId: string, boardIndex: number) {
    send("BOARD_SELL", {matchId, boardIndex});
}

export function chatSend(matchId: string, text: string) {
    send("CHAT_SEND", {matchId, text});
}

export function requestMatchState(matchId: string) {
    send("MATCH_STATE_REQUEST", {matchId});
}

export function lobbySubscribe(lobbyId: string) {
    send("LOBBY_SUBSCRIBE", {lobbyId});
}

export function lobbySetDeck(lobbyId: string, deckId: string) {
    send("LOBBY_SET_DECK", {lobbyId, deckId});
}

export function lobbySetReady(lobbyId: string, isReady: boolean) {
    send("LOBBY_SET_READY", {lobbyId, isReady});
}

export function chatHistoryRequest(matchId: string) {
    send("CHAT_HISTORY_REQUEST", {matchId});
}

window.addEventListener('auth:token-changed', (e: any) => {
    const token = e?.detail ?? null;
    if (typeof token === 'string' && token.length > 0) {
        lastAuthToken = token;
        ensureConnected();
        if (connState === 'connected' && ws) {
            try {
                ws.send(JSON.stringify({v: 1, type: 'AUTH', token: lastAuthToken}));
            } catch {
            }
        }
    } else {
        lastAuthToken = null;
    }
});

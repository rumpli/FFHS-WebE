/**
 * main.ts
 *
 * Application bootstrap and router for the single-page client.
 * Responsibilities:
 * - Initialize observability, audio hooks and websocket handlers.
 * - Restore user session and reconcile persisted match/lobby state.
 * - Provide imperative render functions (renderHome, renderMatch, renderDeck, etc.)
 *   that swap central `#screen-root` content and wire high-level component events.
 * - Listen for global bus / DOM events (match state, lobby events, navigation)
 *   and perform safe, guarded updates.
 *
 * Notes:
 * - This file intentionally uses DOM events and simple string-based templates to
 *   compose screens; lifecycle is driven by custom element events and by the
 *   `state` object shared across modules.
 */

import "./otel";


import "../styles/index.css"


import "./components/health-badge";
import "./components/chat-panel";
import "./components/register-form";
import "./components/login-form";
import "./components/not-implemented-modal";
import "./components/info-modal";
import "./components/leave-lobby-modal";
import "./components/app-footer";
import "./components/audio-mini-player";
import "./components/match-card";
import "./components/battle-anim";
import "./components/code-prompt-modal";


import "./screens/landing-screen";
import "./screens/home-screen";
import "./screens/deck-screen";
import "./screens/collection-screen";
import "./screens/searching-screen";
import "./screens/match-screen";
import "./screens/match-result-screen";
import "./screens/profile-screen";
import "./screens/lobby-screen";
import "./screens/lobby-create-screen";
import "./screens/lobby-join-screen";

import {clearToken, getToken} from "./auth/auth";
import {debug, error, warn} from "./core/log";
import {audio} from "./core/audio";
import {authenticate, ensureConnected, matchJoin, setActiveMatch, lobbySubscribe, matchmakingStart} from "./core/ws";
import {state, resetMatchState} from "./core/store";
import {initMatchWsHandlers} from "./core/match-ws-handler";
import {bus} from "./core/EventBus";
import {getActiveMatch} from "./core/ws";

type User = {
    id: string;
    username: string;
    email: string;
};

let currentUser: User | null = null;
let countdownVisibleUntilTs = 0;

function showNotImplemented() {
    // Small helper to show the not-implemented modal; kept separate to avoid
    // duplicating markup.
    const modal = document.createElement("not-implemented-modal");
    document.body.appendChild(modal);
}

function showGuestConfirm() {
    // Confirmation overlay shown when the user elects to play as a guest.
    // The overlay is intentionally simple and self-removing.
    const overlay = document.createElement("div");
    overlay.className =
        "fixed inset-0 z-50 flex items-center justify-center bg-transparent backdrop-blur-sm";

    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-[90%] p-6 text-center">
        <h2 class="text-xl font-semibold mb-3 text-gray-800">
          Play as Guest?
        </h2>
        <p class="text-gray-600 mb-6">
          Playing as guest will <span class="font-medium text-red-500">not preserve progress</span>.<br>
          Proceed anyway?
        </p>
        <div class="flex justify-center gap-4">
          <button id="guest-cancel" class="btn btn-secondary">Cancel</button>
          <button id="guest-confirm" class="btn btn-primary">Proceed</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector("#guest-cancel")!
        .addEventListener("click", () => overlay.remove());
    overlay.querySelector("#guest-confirm")!
        .addEventListener("click", () => {
            overlay.remove();
            showNotImplemented();
        });
}

function setup() {
    ensureConnected();
    initMatchWsHandlers();
    audio.hookFirstGesture();
    const root = document.getElementById("screen-root") as HTMLElement;
    if (!root) {
        error("#screen-root not found");
        return;
    }

    root.innerHTML = `
      <div class="w-full h-full flex items-center justify-center">
        <div class="card p-4 rounded-xl shadow">Loading…</div>
      </div>
    `;

    bus.on("match:forfeit-info", (p: any) => {
        const {matchId, userId} = p || {};
        if (!matchId) return;
        if (state.matchId && state.matchId !== matchId) return;
        if (userId && userId === state.userId) {
            state.battleLog = [];
            renderHome();
            return;
        }
        debug(`Player ${userId} forfeited match ${matchId}`);
    });

    bus.on('match:state', () => {
        try {
            if (isExceptionHashRoute()) return;
            if (Date.now() < countdownVisibleUntilTs) {
                try {
                    debug('[auto-nav] suppressing auto-navigation while match-found countdown is visible');
                } catch {
                }
                return;
            }

            const appRoot = document.getElementById('screen-root') as HTMLElement | null;
            const startingVisible = !!(appRoot && appRoot.dataset.inStarting && appRoot.dataset.inStarting !== '');
            const searchingVisible = !!(appRoot && appRoot.dataset.inSearching === '1');

            if (document.querySelector('match-screen')) return;

            const mid = String(state.matchId ?? '');
            if (!mid) return;

            // don't auto-navigate into finished matches
            try {
                if (state.matchState && (state.matchState as any).phase === 'finished') {
                    debug('[auto-nav] skipping auto-navigation because match is finished');
                    return;
                }
            } catch {
            }

            if (searchingVisible && !startingVisible) {
                try {
                    debug('[auto-nav] MATCH_STATE arrived while searching - showing match-found countdown', {mid});
                } catch {
                }
                try {

                    delete (appRoot as any).dataset.inSearching;
                } catch {
                }
                renderStarting(mid);
                return;
            }

            if (state.isInMatchFlow && !startingVisible && !searchingVisible) {
                debug('[auto-nav] skipping auto-navigation because user is in match flow');
                return;
            }

            debug('[auto-nav] match:state received, auto-navigating to match-screen', {
                mid,
                startingVisible,
                searchingVisible
            });

            try {
                if (appRoot) {
                    delete (appRoot as any).dataset.inStarting;
                    delete (appRoot as any).dataset.inSearching;
                }
            } catch {
            }
            try {
                state.isSearching = false as any;
                state.isStarting = false as any;
            } catch {
            }
            renderMatch(mid);
        } catch {
        }
    });


    document.addEventListener('lobby:match-started', (e: Event) => {
        try {
            const ce = e as CustomEvent<{ matchId?: string }>;
            const matchId = String(ce?.detail?.matchId ?? '');
            if (!matchId) return;

            // mark match flow and remember match
            state.isInMatchFlow = true;
            state.matchId = matchId;
            try {
                setActiveMatch(matchId);
            } catch {
            }

            // show the same countdown/start UI as matchmaking
            if (!isExceptionHashRoute()) {
                renderStarting(matchId);
            }

            // proactively join & request state (server will respond with MATCH_STATE)
            try {
                matchJoin(matchId);
            } catch {
            }
            import('./core/ws').then(m => m.requestMatchState(matchId)).catch(() => {
            });
        } catch {
        }
    });
    void restoreSession();

    function renderProfile() {
        root.innerHTML = `<profile-screen></profile-screen>`;
        const el = root.querySelector("profile-screen") as HTMLElement;

        el.addEventListener("nav:back", () => {
            renderHome();
        });
    }

    function renderStarting(matchId: string) {
        state.isInMatchFlow = true;
        state.matchId = matchId;
        root.dataset.inStarting = '1';
        countdownVisibleUntilTs = Date.now() + 3_500;
        try {
            setActiveMatch(matchId);
        } catch {
        }
        try {
            matchJoin(matchId);
        } catch {
        }
        import('./core/ws').then(m => m.requestMatchState(matchId)).catch(() => {
        });

        let n = 3;
        root.innerHTML = `
    <div class="card w-[min(520px,90vw)] text-center mx-auto max-h-[90vh] overflow-auto">
      <h2 class="text-lg font-semibold mb-2">Game found!</h2>
      <div class="text-sm text-gray-700 mb-4">Starting in <span id="n">${n}</span>…</div>
      <div class="text-xs text-gray-500">matchId: ${matchId}</div>
    </div>
  `;

        const enter = () => {
            countdownVisibleUntilTs = 0;
            try {
                delete (root as any).dataset.inStarting;
                delete (root as any).dataset.inSearching;
            } catch {
            }
            try {
                state.isSearching = false as any;
                state.isStarting = false as any;
            } catch {
            }
            renderMatch(matchId);
        };

        const tick = () => {
            n -= 1;
            const el = root.querySelector("#n");
            if (el) el.textContent = String(Math.max(0, n));
            if (n <= 0) {
                try {
                    if (state.matchState && (state.matchState as any).matchId === matchId) {
                        debug('[starting] countdown finished - match state already present, entering match', matchId);
                        enter();
                        return;
                    }
                } catch {
                }
                try {
                    debug('[starting] countdown finished - requesting MATCH_STATE and entering match', matchId);
                } catch {
                }
                import('./core/ws').then(m => m.requestMatchState(matchId)).catch(() => {
                });
                setTimeout(() => {

                    enter();
                }, 150);
                return;
            } else {
                setTimeout(tick, 1000);
            }
        };
        setTimeout(tick, 1000);
    }

    function renderMatch(matchId: string) {
        try {
            state.isSearching = false;
        } catch (e) {
        }
        try {
            state.isStarting = false;
        } catch (e) {
        }
        state.isInMatchFlow = true;
        state.battleLog = [];
        state.matchId = matchId;
        setActiveMatch(matchId);
        matchJoin(matchId);
        import("./core/ws").then(m => {
            m.requestMatchState(matchId);
        }).catch(() => {
        });

        root.innerHTML = `<match-screen></match-screen>`;
        const el = root.querySelector("match-screen") as HTMLElement;

        el.addEventListener("match:end-round", () => {
            debug("end round clicked");
        });

        el.addEventListener("match:forfeit", () => {
            renderHome();
        });

        el.addEventListener("match:chat", () => {
            debug("open chat");
        });

        el.addEventListener("shop:reroll", () => {
            debug("reroll requested");
        });
    }

    function renderSearching() {
        state.isInMatchFlow = true;
        root.dataset.inSearching = '1';
        root.innerHTML = `<searching-screen></searching-screen>`;
        const el = root.querySelector("searching-screen") as HTMLElement;
        el.addEventListener("matchmaking:found", (e: Event) => {
            const ce = e as CustomEvent<{ matchId: string }>;
            try {
                state.isSearching = false;
            } catch (err) {
            }
            renderStarting(ce.detail.matchId);
        });

        el.addEventListener("matchmaking:cancel", () => {
            try {
                state.isSearching = false;
            } catch (err) {
            }
            renderDeck();
        });
    }

    function renderCollection() {
        try {
            state.isSearching = false;
        } catch (e) {
        }
        try {
            state.isStarting = false;
        } catch (e) {
        }

        root.innerHTML = `<collection-screen></collection-screen>`;
        const el = root.querySelector("collection-screen") as HTMLElement;

        el.addEventListener("nav:back", () => {
            renderHome();
        });

        el.addEventListener("nav:deck", () => {
            renderDeck();
        });

        el.addEventListener("shop:click", () => {
            showNotImplemented();
        })

        el.addEventListener("nav:shop", () => {
            showNotImplemented();
        });

        el.addEventListener("avatar:click", () => {
            renderProfile();
        });

        el.addEventListener("nav:profile", () => {
            renderProfile();
        });
    }

    function renderDeck() {
        try {
            state.isSearching = false;
        } catch (e) {
        }
        try {
            state.isStarting = false;
        } catch (e) {
        }

        root.innerHTML = `<deck-screen></deck-screen>`;
        const el = root.querySelector("deck-screen") as HTMLElement;

        el.addEventListener("nav:back", () => {
            renderHome();
        });

        el.addEventListener("nav:collection", () => {
            renderCollection();
        });

        el.addEventListener("deck:play", (e: Event) => {
            const ce = e as CustomEvent<{ deckId?: string | null }>;
            const deckId = ce.detail?.deckId ?? null;
            if (deckId) {
                (state as any).selectedDeckId = deckId;
            }
            state.isInMatchFlow = true;
            matchmakingStart(deckId ?? undefined);
            renderSearching();
        });

        el.addEventListener("avatar:click", () => {
            renderProfile();
        });

        el.addEventListener("nav:profile", () => {
            renderProfile();
        });
    }

    function renderLanding() {
        try {
            state.isSearching = false;
        } catch (e) {
        }
        try {
            state.isStarting = false;
        } catch (e) {
        }

        root.innerHTML = `<landing-screen></landing-screen>`;
        const el = root.querySelector("landing-screen") as HTMLElement;

        el.addEventListener("nav:play-guest", () => {
            showGuestConfirm();
        });

        el.addEventListener("nav:login", () => {
            renderLogin();
        });

        el.addEventListener("nav:register", () => {
            renderRegister();
        });
    }

    function renderHome() {
        state.isInMatchFlow = false;
        try {
            resetMatchState();
        } catch (e) {
        }

        try {
            state.isSearching = false;
        } catch (e) {
        }
        try {
            state.isStarting = false;
        } catch (e) {
        }

        root.innerHTML = `<home-screen></home-screen>`;
        const el = root.querySelector("home-screen") as HTMLElement;

        el.addEventListener("avatar:click", () => {
            renderProfile();
        });

        el.addEventListener("nav:profile", () => {
            renderProfile();
        });

        el.addEventListener("nav:play", () => {
            renderDeck();
        });

        el.addEventListener("nav:lobby", () => {
            root.innerHTML = `<lobby-screen></lobby-screen>`;
            const ls = root.querySelector('lobby-screen') as any;
            if (ls) {
                ls.addEventListener('nav:back', () => renderHome());
                ls.addEventListener('nav:lobby-create', () => {
                    root.innerHTML = `<lobby-create-screen></lobby-create-screen>`;
                    const lcs = root.querySelector('lobby-create-screen') as any;
                    if (lcs) lcs.addEventListener('nav:back', () => renderHome());
                });
                ls.addEventListener('nav:lobby-join', () => {
                    root.innerHTML = `<lobby-join-screen></lobby-join-screen>`;
                    const ljs = root.querySelector('lobby-join-screen') as any;
                    ljs.addEventListener('nav:back', () => renderHome());
                });
            }
        });

        el.addEventListener("nav:collection", () => {
            renderCollection();
        });

        el.addEventListener("nav:shop", () => {
            showNotImplemented();
        });

        el.addEventListener("auth:logout", () => {
            state.battleLog = [];
            currentUser = null;
            clearToken();
            try {
                (state as any).userName = '';
            } catch (err) {
            }
            try {
                document.dispatchEvent(new CustomEvent('user:restored', {detail: {user: null}, bubbles: true}));
            } catch (e) {
            }
            renderLanding();
        });
    }

    function attachAuthFormListeners(el: HTMLElement) {
        el.addEventListener(
            "nav:back",
            () => {
                if (currentUser) renderHome();
                else renderLanding();
            },
            {once: true},
        );

        el.addEventListener(
            "login:success",
            (e: Event) => {
                const ce = e as CustomEvent<{ user: User; token?: string }>;
                currentUser = ce.detail.user;
                state.userId = currentUser.id;
                try {
                    (state as any).userName = currentUser.username;
                } catch (err) {
                }
                try {
                    document.dispatchEvent(new CustomEvent('user:restored', {
                        detail: {user: currentUser},
                        bubbles: true
                    }));
                } catch (e) {
                }
                const token = ce.detail.token ?? getToken();
                if (token) authenticate(token);
                renderHome();
            },
            {once: true},
        );
    }

    function renderRegister() {
        try {
            state.isSearching = false;
        } catch (e) {
        }
        try {
            state.isStarting = false;
        } catch (e) {
        }
        root.innerHTML = `<register-form></register-form>`;
        const formEl = root.querySelector("register-form") as HTMLElement;
        attachAuthFormListeners(formEl);
    }

    function renderLogin() {
        try {
            state.isSearching = false;
        } catch (e) {
        }
        try {
            state.isStarting = false;
        } catch (e) {
        }
        root.innerHTML = `<login-form></login-form>`;
        const formEl = root.querySelector("login-form") as HTMLElement;
        attachAuthFormListeners(formEl);
    }


    async function restoreSession(): Promise<User | null> {
        const token = getToken();
        if (!token) {
            debug("[restoreSession] No token found, rendering landing screen.");
            renderLanding();
            return null;
        }
        debug("[restoreSession] Token present — authenticating WS and rendering home immediately.");
        authenticate(token);
        ensureConnected();
        if (!isExceptionHashRoute()) {
            renderHome();
        } else {
            try {
                handleHashRoute();
            } catch (e) {
            }
        }
        await (async () => {
            const API = (window as any).__CFG__.API_URL;
            if (!API) return;
            const controller = new AbortController();
            const timeoutMs = 7000;
            const to = setTimeout(() => controller.abort(), timeoutMs);
            try {
                debug(`[restoreSession-bg] fetching ${API}/me`);
                const res = await fetch(`${API}/me`, {
                    headers: {Authorization: `Bearer ${token}`},
                    signal: controller.signal,
                });
                clearTimeout(to);
                if (!res.ok) {
                    if (res.status === 401) {
                        debug('[restoreSession-bg] /me returned 401 - token invalid, clearing client session');
                        clearToken();
                        currentUser = null;
                        state.userId = '';
                        state.matchId = null;
                        try {
                            state.chat.matchId = null;
                        } catch (e) {
                        }
                        try {
                            state.chat.id = '';
                        } catch (e) {
                        }

                        // clear persisted active match in ws layer
                        try {
                            setActiveMatch(null);
                        } catch (e) {
                        }

                        // render landing so the user can log in again
                        try {
                            renderLanding();
                        } catch (e) {
                        }
                        return;
                    }
                    debug('[restoreSession-bg] /me returned not ok', res.status);
                    return;
                }
                const data = await res.json().catch(() => null);
                if (!data || !data.ok || !data.user) {
                    debug('[restoreSession-bg] /me returned no user');
                    return;
                }
                currentUser = data.user as User;
                state.userId = currentUser.id;
                try {
                    (state as any).userName = currentUser.username;
                } catch (err) {
                }
                try {
                    document.dispatchEvent(new CustomEvent('user:restored', {
                        detail: {user: currentUser},
                        bubbles: true
                    }));
                } catch (e) {
                }
                debug('[restoreSession-bg] user restored', currentUser.id);
                try {
                    const persistedMatch = getActiveMatch();
                    if (persistedMatch) {
                        debug('[restoreSession-bg] found persisted active match, joining', persistedMatch);
                        debug('[restoreSession-bg] isExceptionHashRoute=', isExceptionHashRoute());
                        state.matchId = persistedMatch;
                        state.chat.matchId = persistedMatch;
                        state.chat.id = persistedMatch;
                        setActiveMatch(persistedMatch);
                        matchJoin(persistedMatch);
                        import("./core/ws").then(m => {
                            m.requestMatchState(persistedMatch);
                        }).catch(() => {
                        });
                        if (!isExceptionHashRoute()) {
                            debug('[restoreSession-bg] requested match state for persisted match, awaiting server MATCH_STATE to decide whether to render', persistedMatch);
                        } else {
                            debug('[restoreSession-bg] skipping render for finished match because exception hash');
                        }
                        return;
                    }
                } catch (err) {
                }
                if (data.matchId && data.matchStatus) {
                    debug('[restoreSession-bg] switching to match view', data.matchId, data.matchStatus);
                    debug('[restoreSession-bg] isExceptionHashRoute=', isExceptionHashRoute());
                    state.matchId = data.matchId;
                    state.chat.matchId = data.matchId;
                    state.chat.id = data.matchId;
                    setActiveMatch(data.matchId);
                    matchJoin(data.matchId);
                    switch (data.matchStatus) {
                        case 'searching':
                            if (!isExceptionHashRoute()) {
                                debug('[restoreSession-bg] rendering searching');
                                renderSearching();
                            } else debug('[restoreSession-bg] skipping renderSearching because exception hash');
                            break;
                        case 'starting':
                            if (!isExceptionHashRoute()) {
                                debug('[restoreSession-bg] rendering starting');
                                renderStarting(data.matchId);
                            } else debug('[restoreSession-bg] skipping renderStarting because exception hash');
                            break;
                        case 'finished':
                            try {
                                setActiveMatch(null);
                            } catch (e) {
                            }
                            if (!isExceptionHashRoute()) {
                                debug('[restoreSession-bg] match is finished - not rendering match, showing Home');
                                renderHome();
                            } else {
                                debug('[restoreSession-bg] skipping render for finished match because exception hash');
                            }
                            break;
                        case 'running':
                        default:
                            if (!isExceptionHashRoute()) {
                                debug('[restoreSession-bg] rendering match');
                                renderMatch(data.matchId);
                            } else debug('[restoreSession-bg] skipping renderMatch because exception hash');
                            break;
                    }
                } else if (data.lobby) {
                    try {
                        debug('[restoreSession-bg] re-opening lobby from /api/me', data.lobby.lobbyId);
                        try {
                            (state as any).lobbyId = data.lobby.lobbyId;
                        } catch (e) {
                        }
                        const st = String(data.lobby.status || '').toUpperCase();
                        if (st === 'STARTED') {
                            if (data.lobby.matchId && data.lobby.matchJoinable === false) {
                                try {
                                    warn('[restoreSession-bg] lobby STARTED but match not joinable yet/anymore; staying in lobby', data.lobby.lobbyId, data.lobby.matchId);
                                } catch (e) {
                                }
                                if (!isExceptionHashRoute()) {
                                    const root = document.getElementById('screen-root') as HTMLElement;
                                    root.innerHTML = `<lobby-screen></lobby-screen>`;
                                    customElements.whenDefined('lobby-screen').then(() => {
                                        const el = root.querySelector('lobby-screen') as any;
                                        if (el && typeof el.showLobbyDetail === 'function') el.showLobbyDetail(data.lobby.lobbyId);
                                    });
                                }
                                lobbySubscribe(data.lobby.lobbyId);
                                return;
                            }

                            if (data.lobby.matchId) {
                                debug('[restoreSession-bg] lobby is STARTED and includes matchId, joining match', data.lobby.matchId);
                                state.matchId = data.lobby.matchId;
                                state.chat.matchId = data.lobby.matchId;
                                state.chat.id = data.lobby.matchId;
                                setActiveMatch(data.lobby.matchId);
                                matchJoin(data.lobby.matchId);
                                import("./core/ws").then(m => {
                                    m.requestMatchState(data.lobby.matchId);
                                }).catch(() => {
                                });
                                if (!isExceptionHashRoute()) {
                                    debug('[restoreSession-bg] rendering starting for lobby-started match');
                                    renderStarting(data.lobby.matchId);
                                }
                                return;
                            } else {
                                try {
                                    warn('[restoreSession-bg] /api/me returned STARTED lobby without matchId — subscribing to lobby updates and awaiting matchId', data.lobby.lobbyId);
                                } catch (e) {
                                }

                                if (!isExceptionHashRoute()) {
                                    const root = document.getElementById('screen-root') as HTMLElement;
                                    root.innerHTML = `<lobby-screen></lobby-screen>`;
                                    customElements.whenDefined('lobby-screen').then(() => {
                                        const el = root.querySelector('lobby-screen') as any;
                                        if (el && typeof el.showLobbyDetail === 'function') el.showLobbyDetail(data.lobby.lobbyId);
                                    });
                                }
                                lobbySubscribe(data.lobby.lobbyId);
                                return;
                            }
                        }
                        if (!isExceptionHashRoute()) {
                            const root = document.getElementById('screen-root') as HTMLElement;
                            root.innerHTML = `<lobby-screen></lobby-screen>`;
                            customElements.whenDefined('lobby-screen').then(() => {
                                const el = root.querySelector('lobby-screen') as any;
                                if (el && typeof el.showLobbyDetail === 'function') el.showLobbyDetail(data.lobby.lobbyId);
                            });
                        }
                        lobbySubscribe(data.lobby.lobbyId);
                    } catch (e) {
                        debug('[restoreSession-bg] failed to reopen lobby', e);
                    }
                }
            } catch (err: any) {
                clearTimeout(to);
                debug('[restoreSession-bg] /me fetch failed', err && err.name ? err.name : err);
            }
        })();

        return null;
    }

    function handleHashRoute() {
        try {
            const h = (location.hash || '').replace(/^#/, '');
            if (!h) return; // keep current view
            const parts = h.split('/');
            if (parts[0] === 'match' && parts[2] === 'result') {
                const matchId = decodeURIComponent(parts[1] || '') || state.matchId;
                if (matchId) {
                    root.innerHTML = `<match-result-screen match-id="${matchId}"></match-result-screen>`;
                    return;
                }
            }
            if (parts[0] === 'profile') {
                const playerId = decodeURIComponent(parts[1] || '') || state.userId;
                root.innerHTML = `<profile-screen player-id="${playerId}"></profile-screen>`;
                return;
            }
            if (parts[0] === 'home') {
                renderHome();
                return;
            }
        } catch (err) {
            warn('[router] failed to handle hash route', err);
        }
    }

    function isExceptionHashRoute() {
        try {
            const h = (location.hash || '').replace(/^#/, '');
            if (!h) return false;
            const parts = h.split('/');
            // don't override match result pages or profile pages
            if (parts[0] === 'match' && parts[2] === 'result') return true;
            return parts[0] === 'profile';

        } catch (e) {
            return false;
        }
    }

    window.addEventListener('hashchange', handleHashRoute, {passive: true});
    setTimeout(() => handleHashRoute(), 100);
    document.addEventListener('nav:home', () => {
        try {
            if (!isExceptionHashRoute()) renderHome();
        } catch (e) {
        }
    });

    document.addEventListener('nav:lobby', () => {
        try {
            if (isExceptionHashRoute()) return;
            const root = document.getElementById('screen-root') as HTMLElement;
            if (!root) return;
            root.innerHTML = `<lobby-screen></lobby-screen>`;
            const ls = root.querySelector('lobby-screen') as any;
            if (ls) {
                ls.addEventListener('nav:back', () => renderHome());
                ls.addEventListener('nav:lobby-create', () => {
                    root.innerHTML = `<lobby-create-screen></lobby-create-screen>`;
                    const lcs = root.querySelector('lobby-create-screen') as any;
                    if (lcs) lcs.addEventListener('nav:back', () => renderHome());
                });
                ls.addEventListener('nav:lobby-join', () => {
                    root.innerHTML = `<lobby-join-screen></lobby-join-screen>`;
                    const ljs = root.querySelector('lobby-join-screen') as any;
                    ljs.addEventListener('nav:back', () => renderHome());
                });
            }
        } catch (e) {
        }
    });

    document.addEventListener('nav:back', (e: Event) => {
        if (document.querySelector('lobby-screen')) {
            renderHome();
        }
    });
}

function installUiModes() {
    const mqTight = window.matchMedia("(orientation: landscape) and (max-height: 820px)");
    const mqCompact = window.matchMedia("(orientation: landscape) and (max-height: 700px)");
    const mqMini = window.matchMedia("(orientation: landscape) and (max-height: 600px)");
    const apply = () => {
        const root = document.documentElement;
        root.classList.toggle("ui-tight", mqTight.matches);
        root.classList.toggle("ui-compact", mqCompact.matches);
        root.classList.toggle("ui-mini", mqMini.matches);
        if (root.classList.contains("ui-mini")) root.classList.add("ui-compact");
        if (root.classList.contains("ui-compact")) root.classList.add("ui-tight");
    };

    apply();
    mqTight.addEventListener("change", apply);
    mqCompact.addEventListener("change", apply);
    mqMini.addEventListener("change", apply);

    window.addEventListener("resize", apply, {passive: true});
    window.addEventListener("orientationchange", apply, {passive: true});
}

installUiModes();

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
} else {
    setup();
}

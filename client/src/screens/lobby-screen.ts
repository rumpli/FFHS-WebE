/**
 * lobby-screen.ts
 *
 * Displays lobby list and lobby details. Handles joining, creating and
 * subscribing to lobby updates via websocket. Registered as `<lobby-screen>`.
 */

import {bus} from "../core/EventBus";
import {lobbySetDeck, lobbySetReady, lobbySubscribe} from "../core/ws";
import {state} from "../core/store";
import {getToken} from "../auth/auth";
import {debug} from "../core/log";

let availableDecks: any[] = [];

customElements.define(
    "lobby-screen",
    class extends HTMLElement {
        private lobby: any = null;
        private selectedDeckId: string | null = null;
        private readyPending: boolean = false;
        private searchTerm: string = '';
        private refreshTimer: number | null = null;
        // cache latest fetched lobbies so searches don't re-fetch each keystroke
        private latestLobbies: any[] = [];
        private searchDebounceTimer: number | null = null;

        connectedCallback() {
            this.renderList();
            this.startAutoRefresh();
        }

        disconnectedCallback() {
            if (this.refreshTimer) {
                clearInterval(this.refreshTimer);
                this.refreshTimer = null;
            }
            if (this.searchDebounceTimer) {
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = null;
            }
        }

        private $(sel: string) {
            return this.querySelector(sel) as HTMLElement | null;
        }

        private async loadDecks() {
            const API = (window as any).__CFG__?.API_URL;
            if (!API) return;
            try {
                const token = getToken();
                const headers: any = {};
                if (token) headers.Authorization = `Bearer ${token}`;
                const res = await fetch(`${API}/decks`, {headers});
                if (!res.ok) return;
                const data = await res.json();
                availableDecks = Array.isArray(data.decks) ? data.decks : [];
            } catch {
            }
        }

        private async loadLobbyList() {
            const API = (window as any).__CFG__?.API_URL;
            if (!API) return [];
            try {
                const token = getToken();
                const headers: any = {};
                if (token) headers.Authorization = `Bearer ${token}`;
                const res = await fetch(`${API}/lobbies`, {headers});
                if (!res.ok) return [];
                const data = await res.json();
                return Array.isArray(data.lobbies) ? data.lobbies : [];
            } catch {
                return [];
            }
        }

        private async fetchLobby(id: string) {
            const API = (window as any).__CFG__?.API_URL;
            if (!API) return null;
            try {
                const token = getToken();
                const headers: any = {};
                if (token) headers.Authorization = `Bearer ${token}`;
                const res = await fetch(`${API}/lobbies/${encodeURIComponent(id)}`, {headers});
                if (!res.ok) return null;
                const data = await res.json().catch(() => ({}));
                return data.lobby ?? null;
            } catch {
                return null;
            }
        }

        private startAutoRefresh() {
            if (this.refreshTimer) clearInterval(this.refreshTimer);
            this.refreshTimer = window.setInterval(() => {
                try {
                    this.populateLobbyList(true);
                } catch (e) {
                }
            }, 30000);
        }

        private renderList() {
            this.innerHTML = `
<div class="screens vh-100">
  <div class="home-center center-content">
    <h1 class="text-lg font-semibold mb-2">Lobbies</h1>
    <div class="w-full max-w-md">
      <div class="mb-2 flex gap-2">
        <input id="lobby-search" placeholder="Search by lobby id or player" class="w-full input" />
        <button id="btn-refresh" class="btn">Refresh</button>
      </div>
      <div id="lobby-list" class="flex flex-col gap-2 rounded-2xl shadow p-3">
        <p class="text-sm text-gray-500">Loading lobbies…</p>
      </div>
      <div class="row-buttons-screen m-auto pt-1 self-center">
        <button id="btn-create" class="btn btn-primary w-full">Create Lobby</button>
        <button id="btn-join" class="btn w-full">Join Lobby</button>
        <button id="btn-back" type="button" class="btn btn-secondary w-full">Back</button>
      </div>
    </div>
  </div>
  <app-footer></app-footer>
</div>
`;
            this.bindList();
            this.populateLobbyList();
        }

        private bindList() {
            this.$("#btn-create")?.addEventListener("click", () => {
                this.dispatchEvent(new CustomEvent("nav:lobby-create", {bubbles: true}));
            });
            this.$("#btn-join")?.addEventListener("click", () => {
                this.dispatchEvent(new CustomEvent("nav:lobby-join", {bubbles: true}));
            });

            this.$('#btn-back')?.addEventListener('click', () => {
                try {
                    this.dispatchEvent(new CustomEvent('nav:back', {bubbles: true}));
                } catch (e) {
                }
            });

            const search = this.$('#lobby-search') as HTMLInputElement | null;
            if (search) {
                search.addEventListener('input', () => {
                    this.searchTerm = (search.value || '').trim().toLowerCase();
                    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
                    this.searchDebounceTimer = window.setTimeout(() => {
                        try {
                            this.renderFromCache();
                        } catch (e) {
                        }
                        this.searchDebounceTimer = null;
                    }, 250);
                });
            }

            // manual refresh -> force fetch from API
            this.$('#btn-refresh')?.addEventListener('click', () => {
                this.populateLobbyList(true);
            });
        }

        private async populateLobbyList(forceRefresh: boolean = false) {
            if (forceRefresh || !Array.isArray(this.latestLobbies) || !this.latestLobbies.length) {
                await this.refreshLobbyList();
                return;
            }
            this.renderFromCache();
        }

        private async refreshLobbyList() {
            const container = this.$("#lobby-list");
            if (container) container.innerHTML = `<p class="text-sm text-gray-500">Loading lobbies…</p>`;
            const lobbies = await this.loadLobbyList();
            this.latestLobbies = Array.isArray(lobbies) ? lobbies : [];
            this.renderFromCache();
        }

        private renderFromCache() {
            const container = this.$("#lobby-list");
            if (!container) return;
            const lobbies = this.latestLobbies || [];
            if (!lobbies.length) {
                container.innerHTML = `<p class="text-sm text-gray-500">No open lobbies. Create one.</p>`;
                return;
            }

            const filtered = lobbies.filter((l: any) => {
                if (!this.searchTerm) return true;
                const q = this.searchTerm;
                if (String(l.id).toLowerCase().includes(q)) return true;
                const players = Array.isArray(l.players) ? l.players : [];
                for (const p of players) {
                    const name = (p.user?.username || p.user?.name || p.username || p.userId || '').toString().toLowerCase();
                    if (name.includes(q)) return true;
                }
                // also try owner username fallback
                return !!(l.owner?.username && String(l.owner.username).toLowerCase().includes(q));
            });

            container.innerHTML = filtered.map((l: any) => {
                const lock = l.codeProtected ? '🔒' : '';
                const players = Array.isArray(l.players) ? l.players : [];
                const isFull = (l.playerCount ?? players.length) >= (l.maxPlayers ?? 0);
                const title = `${l.id}${isFull ? ' (FULL)' : ''}`;
                let playerNames: string[] = [];
                if (players.length) {
                    playerNames = players.map((p: any) => p.user?.username ?? p.username ?? p.userId).filter(Boolean);
                } else if (l.owner?.username) {
                    playerNames = [l.owner.username];
                }
                let playersText = '(no players)';
                if (playerNames.length) playersText = playerNames.join(', ');
                else if (typeof l.playerCount === 'number' && l.playerCount > 0) playersText = `${l.playerCount} player${l.playerCount === 1 ? '' : 's'}`;
                return `<div class="p-2 bg-white rounded">
                          <div class="flex items-center justify-between">
                            <div class="text-sm">${lock ? `<span class="mr-2">${lock}</span>` : ''} <strong>${title}</strong></div>
                            <div class="text-xs text-gray-500">${(l.playerCount ?? playerNames.length)} / ${l.maxPlayers}</div>
                          </div>
                          <div class="text-xs text-gray-500 mt-1">${playersText}</div>
                          <div class="flex gap-2 mt-2">
                            <button data-lobby-id="${l.id}" data-code-protected="${!!l.codeProtected}" class="join-lobby btn btn-sm">Join</button>
                          </div>
                        </div>`;
            }).join('');
            container.querySelectorAll('.join-lobby').forEach((btnEl) => {
                const btn = btnEl as HTMLElement;
                btn.addEventListener('click', async (ev: any) => {
                    const idAttr = btn.getAttribute('data-lobby-id');
                    if (!idAttr) return;
                    const cp = btn.getAttribute('data-code-protected') === 'true';
                    await this.handleJoinFromList(idAttr, cp);
                });
            });
        }

        private async handleJoinFromList(id: string, codeProtected: boolean) {
            const API = (window as any).__CFG__?.API_URL;
            if (!API) return;
            const token = getToken() ?? '';
            let providedCode: string | null = null;
            if (codeProtected) {
                // prompt for code
                const prompt = document.createElement('code-prompt-modal') as any;
                prompt.setAttribute('title', 'Enter Lobby Code');
                prompt.setAttribute('placeholder', 'Lobby code');
                document.body.appendChild(prompt);
                const confirmed = await new Promise<{ value?: string, canceled?: boolean }>((resolve) => {
                    const onConfirm = (ev: any) => {
                        resolve({value: ev.detail.value});
                    };
                    const onCancel = () => {
                        resolve({canceled: true});
                    };
                    prompt.addEventListener('prompt:confirm', onConfirm, {once: true});
                    prompt.addEventListener('prompt:cancel', onCancel, {once: true});
                });
                if ((confirmed as any).canceled) return;
                providedCode = (confirmed as any).value || null;
                if (!providedCode) {
                    const m = document.createElement('info-modal') as any;
                    m.setAttribute('title', 'Code required');
                    m.setAttribute('message', 'A lobby code is required to join this lobby.');
                    document.body.appendChild(m);
                    return;
                }
            }

            try {
                const headers: any = {'Content-Type': 'application/json'};
                if (token) headers.Authorization = `Bearer ${token}`;
                const payload: any = {};
                if (providedCode) payload.code = providedCode;
                const joinRes = await fetch(`${API}/lobbies/${encodeURIComponent(id)}/join`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload)
                });
                const data = await joinRes.json().catch(() => ({}));
                if (joinRes.ok && data.ok) {
                    const root = document.getElementById('screen-root') as HTMLElement;
                    root.innerHTML = `<lobby-screen></lobby-screen>`;
                    customElements.whenDefined('lobby-screen').then(() => {
                        const el = root.querySelector('lobby-screen') as any;
                        if (el && typeof el.showLobbyDetail === 'function') el.showLobbyDetail(data.lobby.id);
                    });
                    return;
                } else {
                    const m = document.createElement('info-modal') as any;
                    m.setAttribute('title', 'Join failed');
                    m.setAttribute('message', 'Failed to join lobby: ' + (data.error ?? 'unknown'));
                    document.body.appendChild(m);
                    return;
                }
            } catch (e) {
                const m = document.createElement('info-modal') as any;
                m.setAttribute('title', 'Join failed');
                m.setAttribute('message', 'Failed to join lobby.');
                document.body.appendChild(m);
                return;
            }
        }

        async showLobbyDetail(id: string) {
            await this.loadDecks();
            const l = await this.fetchLobby(id);
            if (!l) {
                const m = document.createElement('info-modal') as any;
                m.setAttribute('title', 'Lobby not found');
                m.setAttribute('message', 'The requested lobby could not be found.');
                document.body.appendChild(m);
                return this.renderList();
            }
            this.lobby = l;
            this.selectedDeckId = (l.players || []).find((p: any) => p.userId === state.userId)?.deckId ?? null;
            lobbySubscribe(id);
            const off = bus.on('ws:msg', (m: any) => {
                try {
                    try {
                        debug('[lobby-screen] ws msg', m && m.type ? m.type : m);
                    } catch (e) {
                    }
                    if (m && m.type === 'LOBBY_STATE' && (!m.lobby || m.lobby.id === id)) {

                        if (!m.lobby) {
                            const im = document.createElement('info-modal') as any;
                            im.setAttribute('title', 'Lobby closed');
                            im.setAttribute('message', 'The lobby was closed.');
                            document.body.appendChild(im);
                            this.dispatchEvent(new CustomEvent('nav:back', {bubbles: true}));
                            return;
                        }

                        const st = String(m.lobby.status || '').toUpperCase();
                        const isStartedWithMatch = st === 'STARTED' && !!m.lobby.matchId;
                        const joinableStatuses = new Set(['OPEN', 'FULL']);
                        if (!isStartedWithMatch && !joinableStatuses.has(st)) {
                            const im = document.createElement('info-modal') as any;
                            im.setAttribute('title', 'Lobby closed');
                            im.setAttribute('message', 'The lobby is no longer available.');
                            document.body.appendChild(im);
                            this.dispatchEvent(new CustomEvent('nav:back', {bubbles: true}));
                            return;
                        }

                        this.lobby = m.lobby;
                        this.readyPending = false;
                        this.selectedDeckId = (this.lobby.players || []).find((p: any) => p.userId === state.userId)?.deckId ?? this.selectedDeckId;
                        this.renderDetail();

                        if (isStartedWithMatch) {
                            this.dispatchEvent(new CustomEvent('lobby:match-started', {
                                detail: {matchId: this.lobby.matchId},
                                bubbles: true
                            }));
                            try {
                                bus.emit('lobby:match-started', {matchId: this.lobby.matchId});
                            } catch (e) {
                            }
                            try {
                                document.dispatchEvent(new CustomEvent('lobby:match-started', {detail: {matchId: this.lobby.matchId}}));
                            } catch (e) {
                            }
                        }
                    }
                } catch {
                }
            });
            this.renderDetail();
            this.addEventListener('nav:back', () => {
                off();
            });
        }

        private renderDetail() {
            const l = this.lobby;
            const decksOptions = availableDecks.map(d => `<option value="${d.id}" ${d.id === this.selectedDeckId ? 'selected' : ''}>${d.name}</option>`).join('');
            const hasEnoughPlayers = (l.players || []).length >= 2;
            const allReady = hasEnoughPlayers && (l.players || []).every((p: any) => p.isReady);
            // play tooltip: explain why Play is disabled
            let playTooltip = '';
            if (!hasEnoughPlayers) playTooltip = 'Need at least 2 players to start.';
            else if (!allReady) playTooltip = 'Waiting for all players to be Ready.';
            const ownPlayer = (l.players || []).find((p: any) => p.userId === state.userId) ?? null;
            const ownIsReady = !!ownPlayer?.isReady;
            const ownHasDeckSelected = !!(ownPlayer?.deckId ?? this.selectedDeckId);
            // compute enabled/disabled booleans for buttons; we'll show a disabled style and still handle clicks so we can show helpful modals
            const startEnabled = allReady;
            const readyEnabled = (ownHasDeckSelected && !this.readyPending);
            this.innerHTML = `
   <div class="screens vh-100">
    <div class="home-center center-content">
       <h1 class="text-lg font-semibold mb-2">Lobby ${l.id}</h1>
       <div class="mb-1 text-xs text-gray-500">Lobby ID: <span id="lobby-id">${l.id}</span> <button id="copy-id" class="btn btn-xs ml-2 p-0">Copy</button></div>
         ${l.code ? `<div class="mb-1 text-xs text-gray-500">Code: <strong id="lobby-code">${l.code}</strong> <button id="copy-code" class="btn btn-xs ml-2 p-0">Copy</button></div>` : ''}
      <div class="w-full max-w-md">
        <div class="card p-3 mb-2">
          <div class="flex items-center gap-2 mb-2">
            <div class="text-sm text-gray-600">Owner: <span class="font-medium">${l.owner?.username ?? 'Unknown'}</span></div>
            <div class="ml-auto text-xs text-gray-500">Players: ${(l.players || []).length} / ${l.maxPlayers}</div>
          </div>
          <div class="text-sm text-gray-600 mb-2">Participants:</div>
          <ul id="players" class="mb-2">
            ${(l.players || []).map((p: any) => {
                const isOwner = p.userId === l.ownerId;
                const readyMark = p.isReady ? '<span class="text-green-500">●</span>' : '<span class="text-gray-300">○</span>';
                const deckName = availableDecks.find(d => d.id === p.deckId)?.name ?? (p.deckId ? 'Custom' : '(none)');
                return `<li class="py-1 flex items-center justify-between">` +
                    `<div><strong>${p.user?.username ?? p.userId}</strong> ${isOwner ? '<span class="text-xs px-2 ml-2 rounded bg-indigo-100 text-indigo-700">host</span>' : ''}</div>` +
                    `<div class="text-xs text-gray-500">${deckName} <span class="ml-2">${readyMark}</span></div>` +
                    `</li>`;
            }).join('')}
         </ul>
         <label class="text-xs text-gray-500">Select Deck</label>
          <select id="deck-select" class="w-full mb-2">
            <option value="" disabled selected hidden>Select a deck</option>
            ${decksOptions}
          </select>
          ${ownHasDeckSelected ? '<div class="text-xs text-gray-400 mb-2"></div>' : '<div class="text-xs text-gray-400 mb-2">Select a deck to enable Ready</div>'}
          <div class="flex items-center gap-2">
           <div class="flex gap-2">
             <button id="btn-back" class="btn btn-secondary">Back</button>
             <button id="btn-ready" class="btn ${readyEnabled ? '' : 'opacity-50 cursor-not-allowed'}" data-enabled="${readyEnabled}" title="${ownHasDeckSelected ? (this.readyPending ? 'Waiting for server...' : 'Toggle Ready') : 'Select a deck first'}">${this.readyPending ? 'Pending...' : (ownIsReady ? 'Not Ready' : 'Ready')}</button>
           </div>
           ${l.ownerId === state.userId ? `<div class="ml-auto"><button id="btn-start" class="btn btn-primary ${startEnabled ? '' : 'opacity-50 cursor-not-allowed'}" data-enabled="${startEnabled}" title="${playTooltip}">Play</button></div>` : ''}
         </div>
        </div>
      </div>
     </div>
    <app-footer></app-footer>
   </div>
   `;
            this.bindDetail();
        }

        private bindDetail() {
            this.$('#btn-back')?.addEventListener('click', async () => {
                const modal = document.createElement('leave-lobby-modal') as any;
                document.body.appendChild(modal);
                const onConfirm = async () => {
                    const API = (window as any).__CFG__?.API_URL;
                    if (!API) {
                        this.dispatchEvent(new CustomEvent('nav:back', {bubbles: true}));
                        return;
                    }
                    const token = getToken() ?? '';
                    try {
                        // If current user is the lobby owner, call the explicit close endpoint so the lobby is deleted and all clients get lobby:null
                        if (this.lobby && this.lobby.ownerId === state.userId) {
                            await fetch(`${API}/lobbies/${encodeURIComponent(this.lobby.id)}/close`, {
                                method: 'POST',
                                headers: {Authorization: `Bearer ${token}`}
                            });
                        } else {
                            await fetch(`${API}/lobbies/${encodeURIComponent(this.lobby.id)}/leave`, {
                                method: 'POST',
                                headers: {Authorization: `Bearer ${token}`}
                            });
                        }
                    } catch (e) {
                    }
                    this.dispatchEvent(new CustomEvent('nav:back', {bubbles: true}));
                };
                const onCancel = () => {
                };
                modal.addEventListener('leave:confirm', onConfirm, {once: true});
                modal.addEventListener('leave:cancel', onCancel, {once: true});
            });

            const startBtn = this.$('#btn-start') as HTMLButtonElement | null;
            if (startBtn) {
                startBtn.addEventListener('click', async () => {
                    try {
                        debug('[lobby-screen] start button clicked, enabled=', startBtn.getAttribute('data-enabled'));
                    } catch (e) {
                    }
                    const enabled = startBtn.getAttribute('data-enabled') === 'true';
                    if (!enabled) {
                        const m = document.createElement('info-modal') as any;
                        m.setAttribute('title', 'Cannot start');
                        const needPlayers = (this.lobby.players || []).length < 2;
                        if (needPlayers) m.setAttribute('message', 'Need at least 2 players to start.');
                        else m.setAttribute('message', 'All players must be Ready before starting the match.');
                        document.body.appendChild(m);
                        return;
                    }
                    const API = (window as any).__CFG__?.API_URL;
                    if (!API) return;
                    const token = getToken() ?? '';
                    // send an explicit empty JSON body so Fastify's JSON parser doesn't reject an empty body
                    const startUrl = `${API}/lobbies/${this.lobby.id}/start`;
                    try {
                        debug('[lobby-screen] calling start', startUrl);
                    } catch (e) {
                    }
                    const res = await fetch(startUrl, {
                        method: 'POST',
                        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
                        body: JSON.stringify({})
                    });
                    let data: any;
                    try {
                        data = await res.json().catch(() => null);
                    } catch (e) {
                        data = null;
                    }
                    try {
                        debug('[lobby-screen] start response', res.status, data);
                    } catch (e) {
                    }
                    if (res.ok && data?.ok) {
                        this.dispatchEvent(new CustomEvent('lobby:match-started', {
                            detail: {matchId: data?.matchId},
                            bubbles: true
                        }));
                        try {
                            bus.emit('lobby:match-started', {matchId: data?.matchId});
                        } catch (e) {
                        }
                        try {
                            document.dispatchEvent(new CustomEvent('lobby:match-started', {detail: {matchId: data?.matchId}}));
                        } catch (e) {
                        }
                    } else {
                        const m = document.createElement('info-modal') as any;
                        m.setAttribute('title', 'Start failed');
                        m.setAttribute('message', 'Failed to start match: ' + (data?.error ?? 'unknown'));
                        document.body.appendChild(m);
                    }
                });
            }

            const readyBtn = this.$('#btn-ready') as HTMLButtonElement | null;
            if (readyBtn) {
                readyBtn.addEventListener('click', () => {
                    const enabled = readyBtn.getAttribute('data-enabled') === 'true';
                    if (!enabled) {
                        const m = document.createElement('info-modal') as any;
                        m.setAttribute('title', 'Select deck first');
                        m.setAttribute('message', 'Please select a deck before toggling Ready.');
                        document.body.appendChild(m);
                        return;
                    }
                    const currentlyReady = !!this.lobby.players.find((p: any) => p.userId === state.userId && p.isReady);
                    this.readyPending = true;
                    try {
                        this.renderDetail();
                    } catch (e) {
                    }
                    lobbySetReady(this.lobby.id, !currentlyReady);
                });
            }

            const deckSelect = this.$('#deck-select') as HTMLSelectElement | null;
            if (deckSelect) {
                deckSelect.addEventListener('change', () => {
                    const val = deckSelect.value || null;
                    this.selectedDeckId = val;
                    if (val) {
                        lobbySetDeck(this.lobby.id, val);
                    } else {
                        lobbySetDeck(this.lobby.id, null as any);
                    }
                    try {
                        this.renderDetail();
                    } catch (e) {
                    }
                });
            }

            const copyIdBtn = this.$('#copy-id');
            if (copyIdBtn) copyIdBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(String(this.lobby.id));
                    const m = document.createElement('info-modal') as any;
                    m.setAttribute('title', 'Copied');
                    m.setAttribute('message', 'Lobby ID copied to clipboard.');
                    document.body.appendChild(m);
                } catch (e) {
                }
            });
            const copyCodeBtn = this.$('#copy-code');
            if (copyCodeBtn) copyCodeBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(String(this.lobby.code));
                    const m = document.createElement('info-modal') as any;
                    m.setAttribute('title', 'Copied');
                    m.setAttribute('message', 'Lobby code copied to clipboard.');
                    document.body.appendChild(m);
                } catch (e) {
                }
            });
        }
    }
);


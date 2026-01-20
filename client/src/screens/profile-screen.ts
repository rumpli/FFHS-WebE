/**
 * profile-screen.ts
 *
 * Shows the current user's profile and match history with infinite scroll.
 * Uses `fetchPlayerProfile` to load paginated data.
 */

import {fetchPlayerProfile} from '../net/profile.js';
import {state} from '../core/store.js';
import {debug, error} from "../core/log";

customElements.define('profile-screen', class extends HTMLElement {
    private content: HTMLElement | null = null;
    private currentPage = 1;
    private pageLimit = 20;
    private hasMore = false;
    private isLoadingPage = false;
    private observer?: IntersectionObserver;
    private userId: string | null = null;
    private initialized = false;

    constructor() {
        super();
    }

    connectedCallback() {
        if (!this.content) {
            this.content = document.createElement('div');
            this.appendChild(this.content);
        }

        if (this.initialized) return;
        this.initialized = true;
        this.renderLoading();
        const uid = state.userId ?? '';
        if (!uid) {
            this.renderError('Not authenticated');
            return;
        }
        this.currentPage = 1;
        this.userId = uid;
        void this.loadAndRender(uid, this.currentPage);
    }

    disconnectedCallback() {
        try {
            this.observer?.disconnect();
        } catch (e) {
        }
        this.observer = undefined;

        this.initialized = false;
    }

    private renderLoading() {
        if (!this.content) return;
        this.content.innerHTML = `<div class="max-w-4xl mx-auto p-4"><div class="card p-4">Loading profile…</div></div>`;
    }

    private renderError(msg: any) {
        if (!this.content) return;
        this.content.innerHTML = `<div class="max-w-4xl mx-auto p-4"><div class="card p-4 text-red-600">${String(msg)}</div><div class="mt-4"><button id="back" class="btn btn-secondary">Back</button></div></div>`;
        this.querySelector('#back')?.addEventListener('click', () => this.dispatchEvent(new CustomEvent('nav:back', {bubbles: true})));
    }

    private async loadAndRender(uid: string, page: number) {
        if (this.isLoadingPage) return;
        try {
            this.isLoadingPage = true;
            const {profile, pagination} = await fetchPlayerProfile(uid, {limit: this.pageLimit, page});
            debug('[profile-screen] fetched profile', {profile, pagination});
            this.hasMore = (pagination && pagination.hasMore) as boolean;
            if (page === 1) {
                this.renderProfile(profile);
            } else {
                this.appendMatches(profile.matches || []);
            }
            this.currentPage = pagination?.page ?? page;
            this.setupInfiniteObserverIfNeeded();
        } catch (e) {
            this.renderError(e);
        } finally {
            this.isLoadingPage = false;
        }
    }

    private setupInfiniteObserverIfNeeded() {
        if (!this.content) return;
        const existing = this.content.querySelector('#infinite-sentinel');
        if (existing) existing.remove();
        if (!this.hasMore) {
            try {
                this.observer?.disconnect();
            } catch (e) {
            }
            this.observer = undefined;
            return;
        }

        const wrap = document.createElement('div');
        wrap.id = 'infinite-sentinel';
        wrap.className = 'mt-2';
        this.content.appendChild(wrap);
        if (!this.observer) {
            this.observer = new IntersectionObserver((entries) => {
                for (const ent of entries) {
                    if (ent.isIntersecting) {
                        if (this.isLoadingPage) return;
                        if (!this.hasMore) {
                            try {
                                this.observer?.disconnect();
                            } catch (e) {
                            }
                            return;
                        }
                        const uid = this.userId ?? (state.userId ?? '');
                        if (!uid) return;
                        const next = this.currentPage + 1;
                        // mark loading and visually indicate; keep sentinel present
                        this.isLoadingPage = true;
                        void this.loadAndRender(uid, next).finally(() => {
                            this.isLoadingPage = false;
                        });
                    }
                }
            }, {root: null, rootMargin: '200px', threshold: 0.1});
        }
        try {
            this.observer.observe(wrap);
        } catch (e) {
        }
    }

    private appendMatches(matches: any[]) {
        if (!this.content) return;
        const list = this.content.querySelector('#match-list') as HTMLElement | null;
        if (!list) return;
        for (const m of matches) {
            const btn = document.createElement('button');
            btn.className = 'card p-3 w-full text-left flex items-center justify-between';

            let opponentLabel = '';
            try {
                // Prefer a pre-computed label from the server, then fall back to arrays
                if (m.opponentsLabel && typeof m.opponentsLabel === 'string') {
                    opponentLabel = m.opponentsLabel;
                } else if (Array.isArray(m.opponents) && m.opponents.length > 0) {
                    const names = m.opponents.map((o: any) => o.username || o.userId || '—').filter(Boolean);
                    if (names.length === 1) opponentLabel = names[0];
                    else if (names.length === 2) opponentLabel = `${names[0]}, ${names[1]}`;
                    else opponentLabel = `${names.length} players`;
                } else if (m.matchResult && Array.isArray(m.matchResult.players)) {
                    const players = m.matchResult.players as any[];
                    const others = players.filter(p => String(p.userId) !== String(state.userId));
                    if (others.length === 0) opponentLabel = '—';
                    else if (others.length === 1) opponentLabel = others[0].username ?? String(others[0].userId ?? '—');
                    else opponentLabel = `${others.length} players`;
                } else if (m.stats && m.stats?.opponentName) {
                    opponentLabel = String(m.stats.opponentName);
                } else {
                    opponentLabel = '—';
                }
            } catch (e) {
                opponentLabel = '—';
            }

            const when = m.createdAt ? new Date(m.createdAt).toLocaleString() : '—';
            const isWin = Number(m.finalRank) === 1;
            const badge = `<span class="px-2 py-1 rounded-full text-xs font-semibold ${isWin ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${isWin ? 'Win' : 'Loss'}</span>`;

            btn.innerHTML = `
                <div>
                    <div class="font-medium">vs ${opponentLabel}</div>
                    <div class="text-sm text-gray-600">${when}</div>
                </div>
                <div class="flex items-center gap-3">
                    ${badge}
                 </div>
            `;

            btn.addEventListener('click', () => {
                try {
                    const root = document.getElementById('screen-root') as HTMLElement;
                    if (root) root.innerHTML = `<match-result-screen match-id="${m.matchId}"></match-result-screen>`;
                } catch (e) {
                    error('failed to open match', e);
                }
            });
            list.appendChild(btn);
        }
    }

    private renderProfile(profile: any) {
        if (!this.content) return;
        const created = new Date(profile.createdAt).toLocaleString();
        this.content.className = 'flex-row justify-center max-w-4xl mx-auto p-4';
        const winRate = (profile.gamesPlayed && profile.gamesPlayed > 0) ? Math.round((Number(profile.gamesWon || 0) / Number(profile.gamesPlayed)) * 100) : 0;
        this.content.innerHTML = `
            <div class="card p-4 mt-4">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-2xl font-semibold">${profile.username}</h2>
                        <div class="text-sm text-gray-600">Joined ${created}</div>
                        <div class="text-sm text-gray-600">Level ${profile.level} · XP ${profile.xp}</div>
                    </div>
                    <div class="text-right">
                        <div class="text-sm">Matches: ${profile.gamesPlayed}</div>
                        <div class="text-sm">Wins: ${profile.gamesWon} <span class="text-gray-500">(${winRate}% win rate)</span></div>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-4 gap-4 mt-2">
                <div class="card p-3 text-center">
                    <div class="text-sm text-gray-600">Damage Dealt</div>
                    <div class="text-xl font-semibold">${profile.totalDamageOut ?? 0}</div>
                </div>
                <div class="card p-3 text-center">
                    <div class="text-sm text-gray-600">Damage Taken</div>
                    <div class="text-xl font-semibold">${profile.totalDamageTaken ?? 0}</div>
                </div>
                <div class="card p-3 text-center">
                    <div class="text-sm text-gray-600">Cards Played</div>
                    <div class="text-xl font-semibold">${profile.cardsPlayed ?? 0}</div>
                </div>
                <div class="card p-3 text-center">
                    <div class="text-sm text-gray-600">Rounds Played</div>
                    <div class="text-xl font-semibold">${profile.roundsPlayed ?? 0}</div>
                </div>
            </div>

            <div class="mt-6 match-history">
                <h3 class="text-lg font-semibold mb-2">Match History</h3>
                <div id="match-list" class="space-y-2"></div>
            </div>

            <div id="load-more-wrap" class="text-center"></div>

            <button id="back" class="btn btn-secondary mt-4">Back</button>
        `;
        this.querySelector('#back')?.addEventListener('click', () => this.dispatchEvent(new CustomEvent('nav:back', {bubbles: true})));
        this.appendMatches(profile.matches || []);
        this.setupInfiniteObserverIfNeeded();
    }
});
export {};


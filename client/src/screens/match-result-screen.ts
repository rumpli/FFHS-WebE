/**
 * match-result-screen.ts
 *
 * Displays an archived match result with player cards, per-round summaries
 * and an embedded replay viewer. Registered as `<match-result-screen>`.
 */

import {fetchMatchResult} from '../net/matches.js';
import '../components/match-result-card';
import '../components/match-round-summary';
import '../components/match-replay';
import {state} from '../core/store';
import {debug, error, warn} from "../core/log";

customElements.define('match-result-screen', class extends HTMLElement {
    private matchId: string | null = null;
    private content: HTMLElement | null = null;
    private bindAbort?: AbortController;

    constructor() {
        super();
    }

    connectedCallback() {
        this.matchId = this.getAttribute('match-id') ?? null;
        if (!this.content) {
            this.content = document.createElement('div');
            this.appendChild(this.content);
        }
        this.renderLoading();
        if (this.matchId) this.loadAndRender(this.matchId).catch((e) => this.renderError(e));
    }

    disconnectedCallback() {
        try {
            this.bindAbort?.abort();
        } catch (e) {
        }
        this.bindAbort = undefined;
    }

    private renderLoading() {
        if (!this.content) return;
        this.content.innerHTML = `<div class="card p-4 m-4">Loading match result…</div>`;
    }

    private renderError(e: any) {
        if (!this.content) return;
        this.content.innerHTML = `<div class="card p-4 m-4 text-red-600">Failed to load match: ${String(e)}</div>`;
    }

    private async loadAndRender(matchId: string) {
        const res = await fetchMatchResult(matchId, true);
        this.renderResult(res);
    }

    private renderResult(res: any) {
        if (!this.content) return;
        const data = res?.result ?? res;
        const winner = data.winnerId ?? null;
        const rounds = Array.isArray(data.rounds) ? data.rounds : [];
        const players = Array.isArray(data.players) ? data.players : [];
        try {
            debug('[match-result] raw result', {
                matchId: data.matchId ?? data.matchId,
                players: players,
                roundsCount: rounds.length,
                sampleRound: rounds[0] ?? null
            });
        } catch (e) {
        }
        try {
            debug('[match-result] rounds detail', rounds.map((rr: any) => ({
                round: rr?.round,
                hasSummary: !!rr?.summary,
                summaryKeys: rr?.summary ? Object.keys(rr.summary) : null,
                hasPlayersInSummary: Array.isArray(rr?.summary?.players),
                stateType: rr?.state ? (Array.isArray(rr.state) ? 'array' : typeof rr.state) : null
            })));
        } catch (e) {
        }

        this.content.innerHTML = `
        <div class="max-w-5xl mx-auto p-4">
          <div class="card p-4 mb-4">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-2xl font-semibold">Match result</h2>
                <div class="text-sm text-gray-600">${new Date(data.finishedAt ?? data.createdAt).toLocaleString()}</div>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 class="text-lg font-semibold mb-2">Players</h3>
              <div id="players-list" class="space-y-2"></div>
            </div>
            <div>
              <h3 class="text-lg font-semibold mb-2">Rounds
               <button id="btn-show-rounds" class="btn btn-secondary ml-3 rounds-open-btn" aria-expanded="false" aria-controls="rounds-list">Show rounds</button>
             </h3>

               <!-- Keep inline list hidden; Show rounds opens modal -->
               <div id="rounds-list" class="border rounded bg-white rounds-inline">
                 <div class="overflow-auto max-h-64">
                   <table id="rounds-table" class="table-auto text-sm w-full">
                     <tbody id="rounds-tbody" class="divide-y"></tbody>
                   </table>
                 </div>
               </div>
             </div>
           </div>

           <div id="replay-root" class="mt-6"></div>
             <div class="flex justify-center gap-4 pt-2">
                 <button id="btn-replay" class="btn btn-primary">Replay</button>
                 <button id="btn-home" class="btn btn-secondary ml-2">Home</button>
             </div>
         </div>
         `;
        const safeCreate = (tag: string) => {
            try {
                return document.createElement(tag);
            } catch (e) {
                try {
                    error('[safeCreate] createElement failed for tag', String(tag), e, new Error().stack);
                } catch (ee) {
                }

                const placeholder = document.createElement('div');
                placeholder.className = 'safe-create-error';
                placeholder.setAttribute('data-safe-create-tag', String(tag));
                placeholder.textContent = `Failed to create element: ${String(tag)}`;
                try {
                    placeholder.style.border = '2px dashed red';
                    placeholder.style.padding = '6px';
                    placeholder.style.background = '#fff7f7';
                } catch (ee) {
                }
                return placeholder;
            }
        };


        const openModal = (title: string, body: HTMLElement) => {
            try {
                document.querySelectorAll('.match-result-modal-overlay').forEach(n => n.remove());
            } catch {
            }

            const overlay = safeCreate('div');
            overlay.className = 'match-result-modal-overlay fixed inset-0 z-50 flex items-center justify-center';
            overlay.style.background = 'rgba(0,0,0,0.6)';
            (overlay.style as any).backdropFilter = 'blur(3px)';
            overlay.style.padding = '16px';

            const inner = safeCreate('div');
            inner.className = 'bg-white rounded-2xl shadow-2xl border border-gray-200';
            inner.style.width = 'min(980px, 96vw)';
            inner.style.maxHeight = '90vh';
            inner.style.overflow = 'auto';
            inner.style.position = 'relative';

            const header = safeCreate('div');
            header.className = 'flex items-center justify-between px-4 py-2';

            const h = safeCreate('div');
            h.className = 'text-lg font-semibold';
            h.textContent = title;

            const closeBtn = safeCreate('button');
            closeBtn.className = 'btn btn-secondary';
            try {
                (closeBtn as HTMLButtonElement).type = 'button';
            } catch (e) {
            }
            closeBtn.textContent = 'Close';

            const close = () => {
                try {
                    document.removeEventListener('keydown', onKeyDown, true);
                } catch {
                }
                try {
                    overlay.remove();
                } catch {
                }
            };

            const onKeyDown = (ev: KeyboardEvent) => {
                if (ev.key === 'Escape') {
                    try {
                        ev.preventDefault();
                        ev.stopPropagation();
                    } catch {
                    }
                    close();
                }
            };

            closeBtn.addEventListener('click', (ev) => {
                try {
                    ev.preventDefault();
                    ev.stopPropagation();
                } catch {
                }
                close();
            });

            header.appendChild(h);
            header.appendChild(closeBtn);

            const contentWrap = safeCreate('div');
            contentWrap.className = '';
            contentWrap.appendChild(body);

            inner.appendChild(header);
            inner.appendChild(contentWrap);
            overlay.appendChild(inner);

            overlay.addEventListener('click', (ev) => {
                if (ev.target === overlay) close();
            });

            document.addEventListener('keydown', onKeyDown, true);
            document.body.appendChild(overlay);

            return overlay;
        };


        const lastRound = rounds.length ? rounds[rounds.length - 1] : null;
        const finalHpMap: Record<string, number> = {};
        if (lastRound && lastRound.summary && Array.isArray(lastRound.summary.players)) {
            for (const sp of lastRound.summary.players) finalHpMap[String(sp.userId)] = Number(sp.towerHp ?? -1);
        }
        let loserId: string | null = null;
        try {
            let min = Infinity;
            for (const uid in finalHpMap) {
                if (finalHpMap[uid] < min) {
                    min = finalHpMap[uid];
                    loserId = uid;
                }
            }
        } catch (e) {
        }

        try {
            const card = this.content.querySelector('.card');
            if (card) {
                const winnerName =
                    players.find((p: any) => String(p.userId) === String(winner))?.username ??
                    (winner ? String(winner) : '—');
                const badge = safeCreate('div');
                badge.className = 'text-sm text-gray-700';
                badge.style.marginTop = '6px';
                badge.textContent = `Winner: ${winnerName}`;
                const right = card.querySelector('div > div:last-child') as HTMLElement | null;
                if (right) right.appendChild(badge); else card.appendChild(badge);
            }
        } catch (e) {
        }

        const pickColorFromId = (id: string) => {
            try {
                let h = 0;
                for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i);
                const v = Math.abs(h) % 360;
                return `hsl(${v} 85% 50%)`;
            } catch (e) {
                return '#6b7280';
            }
        };

        const colorMap: Record<string, string> = {};
        try {
            for (const p of players) {
                if (!p || !p.userId) continue;
                if (p.towerColor === 'red') colorMap[String(p.userId)] = '#ef4444';
                else if (p.towerColor === 'blue') colorMap[String(p.userId)] = '#2563eb';
            }
            for (const r of rounds) {
                const st = Array.isArray(r.state) ? r.state : [];
                for (const s of st) {
                    const uid = String(s?.userId ?? '');
                    const tc = s?.state?.towerColor;
                    if (!uid) continue;
                    if (tc === 'red' && !colorMap[uid]) colorMap[uid] = '#ef4444';
                    if (tc === 'blue' && !colorMap[uid]) colorMap[uid] = '#2563eb';
                }
            }
            for (const p of players) {
                if (!p || !p.userId) continue;
                const uid = String(p.userId);
                if (colorMap[uid]) continue;
                if (typeof p.seat === 'number') colorMap[uid] = p.seat === 0 ? '#2563eb' : '#ef4444';
            }
            for (const p of players) {
                if (!p || !p.userId) continue;
                const uid = String(p.userId);
                if (!colorMap[uid]) colorMap[uid] = pickColorFromId(uid);
            }
        } catch (e) {
        }

        const totalDmgOut: Record<string, number> = {};
        const totalDmgIn: Record<string, number> = {};
        try {
            for (const r of rounds) {
                const summ = r?.summary;
                if (!summ || !Array.isArray(summ.players)) continue;
                for (const sp of summ.players) {
                    const uid = String(sp?.userId ?? '');
                    if (!uid) continue;
                    const out = Number(sp?.totalDamageOut ?? sp?.stats?.damageOut ?? 0) || 0;
                    const inn = Number(sp?.totalDamageIn ?? sp?.stats?.damageIn ?? 0) || 0;
                    totalDmgOut[uid] = (totalDmgOut[uid] || 0) + out;
                    totalDmgIn[uid] = (totalDmgIn[uid] || 0) + inn;
                }
            }
            try {
                debug('[match-result] damage aggregated from round summaries', {totalDmgOut, totalDmgIn});
            } catch (e) {
            }
        } catch (e) {
        }

        const playersList = this.content.querySelector('#players-list') as HTMLElement;
        try {
            for (const p of players) {
                const uid = String(p.userId ?? '');
                const el = safeCreate('match-result-card') as any;
                const totalOut = Number(totalDmgOut[uid] ?? 0) || 0;
                const totalIn = Number(totalDmgIn[uid] ?? 0) || 0;
                const isWinner = uid && winner != null && uid === String(winner);
                const isLoser = uid && loserId != null && uid === String(loserId);
                el.player = {
                    ...p,
                    isWinner,
                    isLoser,
                    totalDamageOut: totalOut,
                    totalDamageIn: totalIn,
                    color: colorMap[uid] ?? pickColorFromId(uid),
                };
                playersList.appendChild(el);
            }
        } catch (e) {
        }

        const renderRoundsInto = (tbody: HTMLElement) => {
            tbody.innerHTML = '';
            for (let i = 0; i < rounds.length; i++) {
                const r = rounds[i];
                const tr = safeCreate('tr');

                const tdSummary = safeCreate('td');
                tdSummary.className = 'px-2 py-2';

                const summaryEl = safeCreate('match-round-summary') as any;

                try {
                    summaryEl.players = players;
                } catch (e) {
                }
                try {
                    const minimal = (Array.isArray(players) ? players.map((pp: any) => ({
                        userId: pp.userId,
                        username: pp.username
                    })) : []);
                    summaryEl.setAttribute('data-parent-players', JSON.stringify(minimal));
                } catch (e) {
                }
                try {
                    summaryEl.setAttribute('data-round-json', JSON.stringify(r));
                } catch (e) {
                }
                try {
                    summaryEl.setAttribute('data-player-colors', JSON.stringify(colorMap));
                } catch (e) {
                }
                try {
                    const prev = i > 0 ? rounds[i - 1] : null;
                    const prevMinimal =
                        (prev && prev.summary && Array.isArray(prev.summary.players))
                            ? prev.summary.players.map((sp: any) => ({
                                userId: sp.userId,
                                totalDamageOut: sp.totalDamageOut ?? sp.stats?.damageOut ?? 0,
                                totalDamageIn: sp.totalDamageIn ?? sp.stats?.damageIn ?? 0,
                            }))
                            : [];
                    summaryEl.setAttribute('data-prev-summary', JSON.stringify(prevMinimal));
                } catch (e) {
                }
                summaryEl.round = r;
                tdSummary.appendChild(summaryEl);
                tr.appendChild(tdSummary);
                tbody.appendChild(tr);
            }
        };

        try {
            const roundsListContainer = this.content.querySelector('#rounds-list') as HTMLElement | null;
            if (roundsListContainer) roundsListContainer.style.display = 'none';
            const roundsTbody = this.content.querySelector('#rounds-tbody') as HTMLElement | null;
            if (roundsTbody) renderRoundsInto(roundsTbody);
        } catch (e) {
        }

        try {
            const content = this.content;
            if (!content) return;
            this.bindAbort?.abort();
            const ac = new AbortController();
            this.bindAbort = ac;
            const {signal} = ac;
            const openFullReplayModal = () => {
                try {
                    const replayEl = safeCreate('match-replay') as any;
                    replayEl.rounds = rounds;
                    replayEl.result = data;

                    try {
                        const localId = state.userId ?? '';
                        if (localId) replayEl.setAttribute('local-user-id', String(localId));
                    } catch {
                    }
                    try {
                        if (Array.isArray(players) && players.length) {
                            if (players[0]?.userId) replayEl.setAttribute('player-a-color', colorMap[String(players[0].userId)]);
                            if (players[1]?.userId) replayEl.setAttribute('player-b-color', colorMap[String(players[1].userId)]);
                        }
                    } catch {
                    }

                    openModal('Replay', replayEl as unknown as HTMLElement);
                } catch (e) {
                    warn('replay failed', e);
                }
            };

            const openRoundsModal = () => {
                try {
                    const body = safeCreate('div');

                    const wrap = safeCreate('div');
                    wrap.className = 'border-t rounded bg-white';

                    const scroller = safeCreate('div');
                    scroller.className = 'overflow-auto';
                    (scroller.style as any).maxHeight = '70vh';

                    const table = safeCreate('table');
                    table.className = 'table-auto text-sm w-full';

                    const tbody = safeCreate('tbody');
                    tbody.className = 'divide-y';

                    table.appendChild(tbody as any);
                    scroller.appendChild(table as any);
                    wrap.appendChild(scroller as any);
                    body.appendChild(wrap as any);

                    renderRoundsInto(tbody as HTMLElement);

                    openModal('Rounds', body as unknown as HTMLElement);
                } catch (e) {
                    warn('show rounds modal failed', e);
                }
            };

            const runHome = () => {
                try {
                    state.matchId = null as any;
                    (state as any).matchState = {} as any;
                    state.chat.matchId = null;
                } catch (e) {
                }
                try {
                    if (window.history && typeof window.history.pushState === 'function') {
                        window.history.pushState({}, '', '/');
                        // notify app to render Home (main.ts listens for nav:home)
                        try {
                            document.dispatchEvent(new CustomEvent('nav:home'));
                        } catch (e) {
                        }
                        return;
                    }
                } catch (e) {
                }
            };

            const handler = (ev: Event) => {
                const t = ev.target as Element | null;
                if (!t) return;
                const replayBtn = t.closest('#btn-replay') as HTMLButtonElement | null;
                if (replayBtn) {
                    try {
                        ev.preventDefault();
                        ev.stopPropagation();
                    } catch {
                    }
                    openFullReplayModal();
                    return;
                }

                const showRoundsBtn = t.closest('#btn-show-rounds') as HTMLButtonElement | null;
                if (showRoundsBtn) {
                    try {
                        ev.preventDefault();
                        ev.stopPropagation();
                    } catch {
                    }
                    openRoundsModal();
                    return;
                }

                const homeBtn = t.closest('#btn-home') as HTMLButtonElement | null;
                if (homeBtn) {
                    try {
                        ev.preventDefault();
                        ev.stopPropagation();
                    } catch {
                    }
                    runHome();
                    return;
                }
            };


            content.addEventListener('click', handler, {capture: true, signal});
            content.addEventListener('pointerup', handler, {capture: true, signal});
            content.addEventListener('replay-round', (ev: any) => {
                try {
                    ev.preventDefault?.();
                    ev.stopPropagation?.();
                } catch {
                }
                const roundObj = ev?.detail?.round;
                if (!roundObj) return;
                try {
                    const replayEl = safeCreate('match-replay') as any;
                    replayEl.rounds = [roundObj];
                    replayEl.result = data;
                    try {
                        const localId = state.userId ?? '';
                        if (localId) replayEl.setAttribute('local-user-id', String(localId));
                    } catch {
                    }
                    try {
                        if (Array.isArray(players) && players.length) {
                            if (players[0]?.userId) replayEl.setAttribute('player-a-color', colorMap[String(players[0].userId)]);
                            if (players[1]?.userId) replayEl.setAttribute('player-b-color', colorMap[String(players[1].userId)]);
                        }
                    } catch {
                    }
                    openModal(`Replay • Round ${String(roundObj.round ?? '')}`, replayEl as unknown as HTMLElement);
                } catch (e) {
                    warn('round replay failed', e);
                }
            }, {capture: true, signal} as any);
        } catch (e) {
        }
    }
});
export {};

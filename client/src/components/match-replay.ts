/**
 * match-replay.ts
 *
 * Component that plays back stored match rounds by creating a `battle-anim`
 * instance and feeding frames and enriched events. Emits `replay:ended` when
 * playback finishes.
 */

import type {StoredMatchResult} from '../../../shared/protocol/types/matchResult.js';
import {enrichEventsWithTickIndex} from './battle-anim-utils';
import {cardToUnitInfo} from '../core/cards';
import {state} from '../core/store';
import {debug, info, error as logError} from '../core/log';

customElements.define('match-replay', class extends HTMLElement {
    private readonly shadow: ShadowRoot;
    result: StoredMatchResult | null = null;
    rounds: any[] | null = null;
    private _currentRound = 0;
    private _ba: any | null = null;
    private _onFinished: any | null = null;
    private _advanceTimer: number | null = null;
    private _advanceToken = 0;

    private _clearWatchdog() {
        try {
            if (this._advanceTimer) window.clearTimeout(this._advanceTimer);
        } catch {
        }
        this._advanceTimer = null;
    }

    constructor() {
        super();
        this.shadow = this.attachShadow({mode: 'open'});
    }

    connectedCallback() {
        if (this.result || this.rounds) this.render();
    }

    private getLocalUserId(): string {
        try {
            const localUserIdAttr = String(this.getAttribute('local-user-id') ?? '');
            const stateUserId = String((state as any).userId ?? '');
            return localUserIdAttr || stateUserId || '';
        } catch {
            return '';
        }
    }

    private findPlayersFromResult(): any[] {
        try {
            if (this.result && Array.isArray(this.result.players) && this.result.players.length) return this.result.players;
            const r = Array.isArray(this.rounds) && this.rounds.length ? this.rounds[0] : null;
            if (r && Array.isArray(r.state)) return r.state.map((s: any) => ({userId: s.userId, username: s.userId}));
        } catch {
        }
        return [];
    }

    private getSeatOwners(): { aOwnerId: string; bOwnerId: string; a: any | null; b: any | null } {
        const players = this.findPlayersFromResult();
        const bySeat0 = players.find((p: any) => Number(p?.seat) === 0) || players[0] || null;
        const bySeat1 = players.find((p: any) => Number(p?.seat) === 1) || players[1] || null;
        const aOwnerId = String(bySeat0?.userId ?? '');
        const bOwnerId = String(bySeat1?.userId ?? aOwnerId ?? '');
        return {aOwnerId, bOwnerId, a: bySeat0, b: bySeat1};
    }

    // battle-anim expects "red" | "blue". match-result-screen may pass #2563eb/#ef4444.
    private toTowerColorToken(c: any): 'red' | 'blue' {
        const s = String(c ?? '').toLowerCase().trim();
        if (s === 'red' || s === 'blue') return s as any;
        if (s.includes('ef4444') || s.includes('#f00') || s.includes('red')) return 'red';
        if (s.includes('2563eb') || s.includes('00f') || s.includes('blue')) return 'blue';
        return 'blue';
    }

    private resolveDisplayMeta(round: any) {
        const localId = this.getLocalUserId();
        const {aOwnerId, bOwnerId, a, b} = this.getSeatOwners();

        const pLocal = [a, b].find((p: any) => String(p?.userId ?? '') === String(localId)) || null;
        const pOpp = [a, b].find((p: any) => String(p?.userId ?? '') !== String(localId)) || null;

        const bottomUserId = String(pLocal?.userId ?? localId ?? aOwnerId ?? '');
        const topUserId = String(pOpp?.userId ?? (bottomUserId === aOwnerId ? bOwnerId : aOwnerId) ?? '');

        const topName = String(pOpp?.username ?? topUserId ?? 'Opponent');
        const bottomName = String(pLocal?.username ?? bottomUserId ?? 'You');

        const players = this.findPlayersFromResult();
        const p0 = players[0] ?? null;
        const p1 = players[1] ?? null;
        const p0Id = String(p0?.userId ?? '');
        const p1Id = String(p1?.userId ?? '');

        const aColorRaw = this.getAttribute('player-a-color');
        const bColorRaw = this.getAttribute('player-b-color');

        const colorForUser = (uid: string): 'red' | 'blue' => {
            if (uid && uid === p0Id && aColorRaw) return this.toTowerColorToken(aColorRaw);
            if (uid && uid === p1Id && bColorRaw) return this.toTowerColorToken(bColorRaw);
            const p = players.find((pp: any) => String(pp?.userId ?? '') === String(uid)) ?? null;
            if (p?.towerColor === 'red' || p?.towerColor === 'blue') return this.toTowerColorToken(p.towerColor);
            if (typeof p?.seat === 'number') return (Number(p.seat) === 0 ? 'blue' : 'red');
            return 'blue';
        };

        const topColor = colorForUser(topUserId);
        const bottomColor = colorForUser(bottomUserId);

        let topLevel = 1;
        let bottomLevel = 1;
        try {
            if (Array.isArray(round?.state)) {
                for (const s of round.state) {
                    const uid = String(s?.userId ?? '');
                    const lvl = Number(s?.state?.towerLevel ?? 0) || 0;
                    if (!lvl) continue;
                    if (uid === topUserId) topLevel = lvl;
                    if (uid === bottomUserId) bottomLevel = lvl;
                }
            }
        } catch {
        }
        return {
            localId,
            aOwnerId,
            bOwnerId,
            topUserId,
            bottomUserId,
            topName,
            bottomName,
            topColor,
            bottomColor,
            topLevel,
            bottomLevel
        };
    }

    render() {
        if (!this.shadow) return;
        if (!this.result && !this.rounds) {
            this.shadow.innerHTML = `<div class="card p-4">No replay data</div>`;
            return;
        }

        const rounds = Array.isArray(this.rounds) && this.rounds.length ? this.rounds : (Array.isArray(this.result?.rounds) ? this.result!.rounds : []);

        this.shadow.innerHTML = `
      <style>
        .toolbar { display:flex; gap:8px; margin-bottom:8px }
        .card { background:white; padding:12px; border-radius:8px }
        .meta { font-size:12px; color:#444 }
      </style>
      <div class="card">
        <div class="toolbar">
          <button id="play" class="btn btn-primary">Play</button>
          <button id="pause" class="btn">Pause</button>
          <select id="speed"><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option></select>
          <div style="flex:1"></div>
          <div class="meta" id="meta-text"></div>
        </div>
        <div id="anim-root"></div>
      </div>
    `;

        const play = this.shadow.querySelector('#play') as HTMLButtonElement | null;
        const pause = this.shadow.querySelector('#pause') as HTMLButtonElement | null;
        const speed = this.shadow.querySelector('#speed') as HTMLSelectElement | null;
        const metaText = this.shadow.querySelector('#meta-text') as HTMLElement | null;

        play?.addEventListener('click', () => {
            try {
                (this._ba as any)?.play?.();
            } catch (e) {
            }
        });
        pause?.addEventListener('click', () => {
            try {
                (this._ba as any)?.pause?.();
            } catch {
            }
        });
        speed?.addEventListener('change', () => {
            try {
                (this._ba as any)?.setSpeed?.(speed!.value);
            } catch {
            }
        });

        this._clearWatchdog();

        this._onFinished = (ev: any) => {
            try {
                const current = this._ba as any;
                const expectedKey = String(current?.getAttribute?.('data-anim-key') ?? '');
                const gotKey = String(ev?.detail?.key ?? '');
                const gotRound = String(ev?.detail?.round ?? '');
                debug('[match-replay] animation:finished', {
                    currentRoundIdx: this._currentRound,
                    expectedKey,
                    gotKey,
                    gotRound
                });
                if (expectedKey && gotKey && expectedKey !== gotKey) {
                    debug('[match-replay] ignore finished (key mismatch)', {expectedKey, gotKey});
                    return;
                }
            } catch (e) {
                try {
                    logError('[match-replay] finished handler error', e);
                } catch {
                }
            }

            this._clearWatchdog();

            const nextIdx = this._currentRound + 1;
            if (nextIdx < rounds.length) {
                debug('[match-replay] advancing to next round', {
                    fromIdx: this._currentRound,
                    toIdx: nextIdx,
                    toRound: rounds[nextIdx]?.round
                });
                setTimeout(() => this._loadRoundWithBa(nextIdx, metaText, rounds), 120);
            } else {
                info('[match-replay] replay ended', {rounds: rounds.length});
                try {
                    this.dispatchEvent(new CustomEvent('replay:ended', {detail: {matchId: this.result?.matchId}}));
                } catch {
                }
            }
        };

        this._currentRound = 0;
        this._loadRoundWithBa(0, metaText, rounds);
    }

    private _scheduleAdvanceWatchdog(roundIdx: number, rounds: any[], estimatedMs: number, metaText: HTMLElement | null) {
        this._advanceToken++;
        const token = this._advanceToken;
        this._clearWatchdog();
        this._advanceTimer = window.setTimeout(() => {
            if (token !== this._advanceToken) return;
            if (this._currentRound !== roundIdx) return;
            const nextIdx = roundIdx + 1;
            if (nextIdx >= rounds.length) return;
            info('[match-replay] watchdog forcing advance', {fromIdx: roundIdx, toIdx: nextIdx, afterMs: estimatedMs});
            this._loadRoundWithBa(nextIdx, metaText, rounds);
        }, Math.max(500, Math.floor(estimatedMs)));
    }

    private _loadRoundWithBa(idx: number, metaText: HTMLElement | null, rounds: any[]) {
        if (!Array.isArray(rounds) || idx < 0 || idx >= rounds.length) return;
        this._currentRound = idx;
        debug('[match-replay] load round', {idx, round: rounds[idx]?.round, total: rounds.length});
        const root = this.shadow.querySelector('#anim-root') as HTMLElement | null;
        if (!root) return;
        const ba = document.createElement('battle-anim') as any;
        try {
            ba.setAttribute('data-anim-owned', 'true');
        } catch {
        }
        try {
            ba.setAttribute('data-no-remove', 'true');
        } catch {
        }
        try {
            ba.style.display = 'block';
            ba.style.width = '100%';
        } catch {
        }

        root.innerHTML = '';
        root.appendChild(ba);
        this._ba = ba;

        // (Re)bind finished handler to this element
        if (this._onFinished) {
            try {
                ba.addEventListener('animation:finished', this._onFinished);
            } catch {
            }
        }

        const r = rounds[idx];
        const replay = (r as any)?.replay ?? null;
        if (!replay || !Array.isArray(replay.events)) {
            if (metaText) metaText.textContent = `Round ${String(r.round ?? idx + 1)} • missing replay data`;
            logError('[match-replay] missing round.replay payload; cannot play replay', {round: r?.round, replay});
            try {
                ba.pause?.();
            } catch {
            }
            return;
        }

        const matchId = String(this.result?.matchId ?? '');
        const roundNo = String(r?.round ?? idx + 1);
        const key = `replay:${matchId}:${roundNo}:${idx}`;
        try {
            ba.setAttribute('data-anim-key', key);
            debug('[match-replay] set anim key', {idx, round: r?.round, key});
        } catch {
        }

        const events = replay.events;
        if (metaText) metaText.textContent = `Round ${String(r.round ?? idx + 1)} • events: ${events.length}`;

        const SIM_TICK_MS = 100;
        const extraPadMs = 600;

        const tickMsForAnim = 300;
        const postDelayMs = 1700;

        const maxOffset = Math.max(...events.map((e: any) => Number(e?.atMsOffset ?? 0)), 0);
        const ticksFromOffsets = Math.max(6, Math.ceil((maxOffset + extraPadMs) / SIM_TICK_MS));
        const ticksToReach = Number(replay?.ticksToReach) > 0 ? Math.max(6, Number(replay.ticksToReach)) : ticksFromOffsets;

        this._scheduleAdvanceWatchdog(idx, rounds, (ticksToReach + 2) * tickMsForAnim + postDelayMs, metaText);

        try {
            const dm = this.resolveDisplayMeta(r);

            const ownOwnerId = String(dm.bottomUserId ?? dm.localId ?? '');
            const oppOwnerId = String(dm.topUserId ?? '');

            if (ownOwnerId) ba.setAttribute('own-user-id', ownOwnerId);
            if (oppOwnerId) ba.setAttribute('opp-user-id', oppOwnerId);
            if (dm.localId) ba.setAttribute('local-user-id', dm.localId);

            if (dm.localId && dm.aOwnerId && dm.bOwnerId) ba.setAttribute('local-sim-lane', String(dm.localId === dm.aOwnerId ? 0 : 1));

            ba.setAttribute('top-name', dm.topName);
            ba.setAttribute('top-color', dm.topColor);
            ba.setAttribute('top-level', String(dm.topLevel || 1));

            ba.setAttribute('bottom-name', dm.bottomName);
            ba.setAttribute('bottom-color', dm.bottomColor);
            ba.setAttribute('bottom-level', String(dm.bottomLevel || 1));

            ba.setAttribute('tick-ms', String(tickMsForAnim));

            const simInitialUnits = replay.initialUnits;
            const simShotsPerTick = replay.shotsPerTick;
            const simPerTickSummary = replay.perTickSummary;

            if (!Array.isArray(simInitialUnits) || simInitialUnits.length === 0) {
                logError('[match-replay] missing replay.initialUnits; cannot animate units', {round: r?.round, replay});
            }

            let aOwnerId = String(dm.aOwnerId ?? '');
            let bOwnerId = String(dm.bOwnerId ?? aOwnerId ?? '');
            if ((!aOwnerId || !bOwnerId) && Array.isArray(r?.state)) {
                aOwnerId = String(r.state?.[0]?.userId ?? aOwnerId ?? '');
                bOwnerId = String(r.state?.[1]?.userId ?? bOwnerId ?? aOwnerId ?? '');
            }

            const flatUnits = Array.isArray(simInitialUnits) ? simInitialUnits : [];
            const initA = flatUnits.filter((u: any) => String(u?.ownerUserId ?? '') === aOwnerId);
            const initB = flatUnits.filter((u: any) => String(u?.ownerUserId ?? '') === bOwnerId);

            const makeUnits = (src: any[], tick: number) =>
                src.map((u: any) => {
                    let type = u.type || 'goblin';
                    let hp = typeof u.hp === 'number' ? u.hp : undefined;
                    let maxHp = typeof u.maxHp === 'number' ? u.maxHp : undefined;
                    try {
                        const cardRef = u.cardId ?? u.card ?? (u?.config?.cardId ?? null);
                        if ((!type) && cardRef) {
                            const info = cardToUnitInfo(cardRef as any);
                            type = info.type || type;
                            if (!Number.isFinite(hp as any)) hp = info.hp;
                            if (!Number.isFinite(maxHp as any)) maxHp = info.hp;
                        }
                    } catch {
                    }
                    return {
                        id: u.id,
                        type: type || 'goblin',
                        approach: Math.max(0, (Number(u.approach) || ticksToReach) - tick),
                        hp: typeof hp === 'number' ? hp : undefined,
                        maxHp: typeof maxHp === 'number' ? maxHp : undefined,
                        ownerUserId: String(u?.ownerUserId ?? ''),
                    };
                });

            const frames: any[] = [];
            for (let tick = 0; tick <= ticksToReach; tick++) {
                frames.push({
                    tick,
                    ticksToReach,
                    aUnits: makeUnits(initA, tick),
                    bUnits: makeUnits(initB, tick),
                    projectiles: []
                });
            }

            // deterministic projectiles from shotsPerTick (scheduler parity)
            if (Array.isArray(simShotsPerTick) && simShotsPerTick.length) {
                const laneWidth = 700;
                const yTop = 36;
                const yBottom = 84;
                for (let t = 0; t < frames.length; t++) {
                    const sp = simShotsPerTick[t] ?? {aShots: 0, bShots: 0};
                    const aN = Math.max(0, Number(sp.aShots) || 0);
                    for (let i = 0; i < aN; i++) {
                        const frac = (i + 1) / (aN + 1);
                        frames[t].projectiles.push({x: Math.floor(frac * laneWidth + 40), y: yTop});
                    }
                    const bN = Math.max(0, Number(sp.bShots) || 0);
                    for (let i = 0; i < bN; i++) {
                        const frac = (i + 1) / (bN + 1);
                        frames[t].projectiles.push({x: Math.floor(frac * laneWidth + 40), y: yBottom});
                    }
                }
            }

            const enrichedEvents = enrichEventsWithTickIndex(events, ticksToReach, SIM_TICK_MS);

            // pass through sim hints unchanged (important for battle-anim seeding)
            try {
                ba.initialUnits = simInitialUnits;
                ba.perTickSummary = Array.isArray(simPerTickSummary) ? simPerTickSummary : undefined;
                ba.shotsPerTick = Array.isArray(simShotsPerTick) ? simShotsPerTick : undefined;
            } catch {
            }

            ba.frames = frames;
            ba.events = enrichedEvents;

            debug('[match-replay] configured battle-anim', {
                idx,
                round: r?.round,
                ticksToReach,
                events: Array.isArray(events) ? events.length : 0,
                frames: Array.isArray(frames) ? frames.length : 0,
                perTickSummary: Array.isArray(simPerTickSummary) ? simPerTickSummary.length : 0,
                shotsPerTick: Array.isArray(simShotsPerTick) ? simShotsPerTick.length : 0,
                initialUnits: Array.isArray(simInitialUnits) ? simInitialUnits.length : 0,
            });

            if (this.result?.matchId) ba.setAttribute('match-id', String(this.result.matchId));
            if (typeof r?.round !== 'undefined') ba.setAttribute('round', String(r.round));

            setTimeout(() => {
                try {
                    ba.play();
                } catch {
                }
            }, 10);
        } catch (e) {
            logError('[match-replay] failed to configure battle-anim for round', e);
        }
    }
});

export {};

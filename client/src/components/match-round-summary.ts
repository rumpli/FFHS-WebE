/**
 * match-round-summary.ts
 *
 * Renders a compact per-round summary showing participating players, HP and
 * damage statistics. Accepts data via properties or attributes (JSON serialized)
 * and emits `replay-round` when the replay button is clicked.
 */

import {debug, warn} from "../core/log";

customElements.define('match-round-summary', class extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {
        this.classList.add('match-round-summary');
        if (!(this as any)._rendered) this.render();
    }

    set round(v: any) {
        (this as any)._round = v;
        this.render();
    }

    private emitReplay(roundObj: any) {
        try {
            this.dispatchEvent(new CustomEvent('replay-round', {
                detail: {round: roundObj},
                bubbles: true,
                composed: true,
            }));
        } catch (e) {
        }
    }

    render() {
        let r = (this as any)._round ?? {};
        try {
            const attr = this.getAttribute('data-round-json');
            if ((!(r && (r.summary || (Array.isArray(r.events) && r.events.length) || r.state))) && attr) {
                try {
                    const parsed = JSON.parse(attr);
                    if (parsed) r = parsed;
                } catch (e) {
                }
            }
        } catch (e) {
        }

        let providedColorMap: Record<string, string> = {};
        try {
            const raw = this.getAttribute('data-player-colors');
            if (raw) providedColorMap = JSON.parse(raw) as Record<string, string> ?? {};
        } catch (e) {
            providedColorMap = {};
        }

        let parentPlayersAttr: Array<{ userId: string, username?: string } | null> = [];
        try {
            const raw = this.getAttribute('data-parent-players');
            if (raw) parentPlayersAttr = JSON.parse(raw) as any;
        } catch (e) {
            parentPlayersAttr = [];
        }

        let prevSummaryAttr: Array<{ userId: string, totalDamageOut?: number, totalDamageIn?: number }> = [];
        try {
            const raw = this.getAttribute('data-prev-summary');
            if (raw) prevSummaryAttr = JSON.parse(raw) as any;
        } catch (e) {
            prevSummaryAttr = [];
        }

        try {
            debug('[match-round-summary] render called', {
                roundObj: r,
                hasSummary: !!r?.summary,
                summaryType: r && typeof r.summary,
                hasState: !!r?.state,
                stateType: Array.isArray(r?.state) ? 'array' : typeof r?.state,
                parentPlayersProp: (this as any).players ?? null,
                parentPlayersAttr,
                providedColorMap
            });
        } catch (e) {
        }
        const eventsCount = Array.isArray(r.events) ? r.events.length : 0;

        let players: any[] = [];
        let dataSource = 'none';
        try {
            let summary: any = r.summary;
            if (typeof summary === 'string') {
                try {
                    summary = JSON.parse(summary);
                } catch (e) {
                }
            }

            if (summary && Array.isArray(summary.players)) {
                players = summary.players;
                dataSource = 'summary.players';
            } else if (summary && typeof summary.players === 'object' && summary.players !== null) {

                try {
                    players = Object.values(summary.players);
                    dataSource = 'summary.players.map';
                } catch (e) {
                }
            } else if (r.state) {
                const st = r.state;
                if (Array.isArray(st) && st.length) {
                    const first = st[0];
                    if (first && (typeof first.userId === 'string' || typeof first.matchPlayerId === 'string') && first.state) {
                        players = st.map((entry: any) => ({
                            userId: entry.userId ?? entry.matchPlayerId ?? '',
                            username: entry.username ?? undefined,
                            towerHp: entry.state?.towerHp,
                            towerHpMax: entry.state?.towerHpMax,
                            totalDamageOut: entry.state?.totalDamageOut ?? entry.state?.totalDamageOut,
                            totalDamageIn: entry.state?.totalDamageIn ?? entry.state?.totalDamageIn
                        }));
                        dataSource = 'state.userSnapshots';
                    } else {
                        const last = st[st.length - 1];
                        if (last && Array.isArray(last.players)) {
                            players = last.players;
                            dataSource = 'state[last].players';
                        } else if (last && typeof last.players === 'object' && last.players !== null) {
                            try {
                                players = Object.values(last.players);
                                dataSource = 'state[last].players.map';
                            } catch (e) {
                            }
                        }
                    }
                } else if (Array.isArray((st as any).players)) {
                    players = (st as any).players;
                    dataSource = 'state.players';
                } else if ((st as any) && typeof (st as any).players === 'object') {
                    try {
                        players = Object.values((st as any).players);
                        dataSource = 'state.players.map';
                    } catch (e) {
                    }
                }
            }
        } catch (e) {
            try {
                warn('[match-round-summary] failed to derive players from round', e, r);
            } catch {
            }
        }

        const stateLookup: Record<string, any> = {};
        try {
            const st = r.state;
            if (Array.isArray(st)) {
                for (const entry of st) {
                    try {
                        const uid = String(entry?.userId ?? '');
                        if (!uid) continue;
                        if (entry.state) stateLookup[uid] = entry.state;
                        if (Array.isArray(entry?.players)) {
                            for (const p of entry.players) {
                                if (p && p.userId) stateLookup[String(p.userId)] = p;
                            }
                        }
                    } catch (e) {
                    }
                }
            } else if (st && typeof st === 'object' && Array.isArray((st as any).players)) {
                for (const p of (st as any).players) if (p && p.userId) stateLookup[String(p.userId)] = p;
            }
        } catch (e) {
        }

        if ((!players || !players.length) && Array.isArray(r.events) && r.events.length) {
            try {
                const dmgOut: Record<string, number> = {};
                const dmgIn: Record<string, number> = {};
                for (const ev of r.events) {
                    if (!ev || ev.type !== 'damage') continue;
                    const from = String(ev.fromUserId ?? ev.userId ?? '');
                    const to = String(ev.toUserId ?? '');
                    const amt = Number(ev.amount ?? 0) || 0;
                    if (from) dmgOut[from] = (dmgOut[from] || 0) + amt;
                    if (to) dmgIn[to] = (dmgIn[to] || 0) + amt;
                }
                const uids = new Set<string>([...Object.keys(dmgOut), ...Object.keys(dmgIn)]);
                players = Array.from(uids).map(uid => ({
                    userId: uid,
                    totalDamageOut: dmgOut[uid] || 0,
                    totalDamageIn: dmgIn[uid] || 0
                }));
                if (players.length) dataSource = 'events.aggregated';
            } catch (e) {
            }
        }

        const prevTotals: Record<string, { out: number, in: number }> = {};
        try {
            if (Array.isArray(prevSummaryAttr)) {
                for (const ps of prevSummaryAttr) {
                    try {
                        const uid = String(ps?.userId ?? '');
                        if (!uid) continue;
                        prevTotals[uid] = {
                            out: Number(ps.totalDamageOut ?? 0) || 0,
                            in: Number(ps.totalDamageIn ?? 0) || 0
                        };
                    } catch (e) {
                    }
                }
            }
        } catch (e) {
        }

        // If still empty, fall back to parent players
        if ((!players || !players.length)) {
            try {
                const propParents = (this as any).players;
                if (Array.isArray(propParents) && propParents.length) {
                    players = propParents.map((pp: any) => ({
                        userId: pp.userId,
                        username: pp.username ?? pp.userId,
                        towerHp: pp.stats?.towerHp,
                        towerHpMax: pp.stats?.towerHpMax
                    }));
                    dataSource = 'prop.players';
                } else if (Array.isArray(parentPlayersAttr) && parentPlayersAttr.length) {
                    players = parentPlayersAttr.map((pp: any) => ({
                        userId: pp.userId,
                        username: pp.username ?? pp.userId
                    }));
                    dataSource = 'attr.parentPlayers';
                }
            } catch (e) {
            }
        }

        const parentPlayersMap: Record<string, any> = {};
        try {
            if (Array.isArray((this as any).players)) {
                for (const pp of (this as any).players) if (pp && pp.userId) parentPlayersMap[String(pp.userId)] = pp;
            }
            if (Array.isArray(parentPlayersAttr)) {
                for (const pp of parentPlayersAttr) if (pp && pp.userId && !parentPlayersMap[String(pp.userId)]) parentPlayersMap[String(pp.userId)] = pp;
            }
        } catch (e) {
        }

        if (players && players.length) {
            for (const p of players) {
                try {
                    const uid = String(p?.userId ?? '');
                    if ((!p?.username || p.username === '') && parentPlayersMap[uid]) p.username = parentPlayersMap[uid].username ?? parentPlayersMap[uid].userId ?? uid;
                    if ((p?.towerHp == null) && parentPlayersMap[uid] && typeof parentPlayersMap[uid].towerHp === 'number') p.towerHp = parentPlayersMap[uid].towerHp;
                    if ((p?.towerHpMax == null) && stateLookup[uid] && typeof stateLookup[uid].towerHpMax === 'number') p.towerHpMax = stateLookup[uid].towerHpMax;
                    if ((p?.towerHpMax == null) && parentPlayersMap[uid] && typeof parentPlayersMap[uid].towerHpMax === 'number') p.towerHpMax = parentPlayersMap[uid].towerHpMax;
                    if ((p?.towerHp == null) && stateLookup[uid] && typeof stateLookup[uid].towerHp === 'number') p.towerHp = stateLookup[uid].towerHp;
                    if ((!p?.towerColor) && stateLookup[uid] && stateLookup[uid].towerColor) p.towerColor = stateLookup[uid].towerColor;
                    if ((!p?.towerColor) && parentPlayersMap[uid] && parentPlayersMap[uid].towerColor) p.towerColor = parentPlayersMap[uid].towerColor;
                } catch (e) {
                }
            }
        }

        const pickColor = (id: string) => {
            try {
                let h = 0;
                for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i);
                return `hsl(${Math.abs(h) % 360} 85% 50%)`;
            } catch (e) {
                return '#6b7280';
            }
        };

        function escapeHtml(s: string) {
            return String(s).replace(/[&<>'"]/g, (c) => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '\"': '&quot;',
                "'": '&#39;'
            } as any)[c]);
        }

        this.innerHTML = `
        <div class="row">
          <div class="header">
            <div class="left">Round ${escapeHtml(String(r.round ?? ''))}</div>
            <div class="muted">Events: ${eventsCount}</div>
            <div class="muted"> Action: 
              <button type="button" class="btn btn-secondary mrs-replay-btn" data-round="${escapeHtml(String(r.round ?? ''))}">Replay</button>
            </div>
          </div>

          <div class="players"></div>
        </div>
        `;

        // Wire replay button (light DOM; works when moved into modal; NOT when cloned)
        try {
            const btn = this.querySelector('.mrs-replay-btn') as HTMLButtonElement | null;
            if (btn) {
                btn.onclick = null;
                btn.addEventListener('click', (ev) => {
                    try {
                        ev.preventDefault();
                        ev.stopPropagation();
                    } catch {
                    }
                    this.emitReplay(r);
                });
            }
        } catch (e) {
        }

        const container = this.querySelector('.players') as HTMLElement | null;
        if (container && Array.isArray(players) && players.length) {
            for (const p of players) {
                try {
                    const uid = String(p?.userId ?? '');
                    const name = String((p?.username ?? uid) || '—');
                    const hp = typeof p?.towerHp === 'number' ? p.towerHp : (typeof p?.towerHp === 'string' ? Number(p.towerHp) : null);
                    const hpMax = typeof p?.towerHpMax === 'number' ? p.towerHpMax : (stateLookup[uid] && typeof stateLookup[uid].towerHpMax === 'number' ? stateLookup[uid].towerHpMax : (hp != null ? Math.max(1, hp) : 1000));
                    const hpPct = (hp != null && hpMax > 0) ? Math.max(0, Math.min(100, (hp / hpMax) * 100)) : 0;
                    const color = providedColorMap[String(uid)] ?? (p?.towerColor === 'red' ? '#ef4444' : (p?.towerColor === 'blue' ? '#2563eb' : pickColor(uid || name)));

                    let cumOut = Number(p?.totalDamageOut ?? p?.stats?.damageOut ?? p?.damageOut ?? 0) || 0;
                    let cumIn = Number(p?.totalDamageIn ?? p?.stats?.damageIn ?? p?.damageIn ?? 0) || 0;

                    let perOut = cumOut;
                    let perIn = cumIn;
                    try {
                        const prev = prevTotals[String(uid)];
                        if (prev) {
                            perOut = Math.max(0, cumOut - (prev.out || 0));
                            perIn = Math.max(0, cumIn - (prev.in || 0));
                        }
                    } catch (e) {
                    }

                    const dmgOut = perOut;
                    const dmgIn = perIn;

                    const wrap = document.createElement('div');
                    wrap.className = 'player';
                    const meta = document.createElement('div');
                    meta.className = 'player-meta';

                    const avatar = document.createElement('div');
                    avatar.className = 'avatar';
                    avatar.style.background = String(color);
                    avatar.textContent = (name || '?')[0] ?? '?';
                    const info = document.createElement('div');
                    info.className = 'player-info';
                    const pname = document.createElement('div');
                    pname.className = 'player-name';
                    pname.textContent = name;

                    const hpRow = document.createElement('div');
                    hpRow.className = 'hp-row';
                    const hpOuter = document.createElement('div');
                    hpOuter.className = 'hp-bar-outer';
                    hpOuter.title = hp != null ? (String(hp) + '/' + String(hpMax)) : 'HP unknown';
                    const hpInner = document.createElement('div');
                    hpInner.className = 'hp-bar-inner';
                    hpInner.style.width = String(hpPct) + '%';
                    hpInner.style.background = String(color);
                    hpOuter.appendChild(hpInner);
                    const hpText = document.createElement('div');
                    hpText.className = 'hp-text';
                    hpText.textContent = hp != null ? (String(hp) + '/' + String(hpMax)) : '—';
                    hpRow.appendChild(hpOuter);
                    hpRow.appendChild(hpText);

                    info.appendChild(pname);
                    info.appendChild(hpRow);
                    meta.appendChild(avatar);
                    meta.appendChild(info);

                    const stats = document.createElement('div');
                    stats.className = 'player-stats';
                    const outDiv = document.createElement('div');
                    outDiv.className = 'damage';
                    outDiv.innerHTML = `<span class="arrow">➜</span> <span class="val">${dmgOut}</span>`;
                    const inDiv = document.createElement('div');
                    inDiv.className = 'damage in';
                    inDiv.innerHTML = `<span class="arrow">⬅</span> <span class="val">${dmgIn}</span>`;
                    stats.appendChild(outDiv);
                    stats.appendChild(inDiv);

                    wrap.appendChild(meta);
                    wrap.appendChild(stats);
                    container.appendChild(wrap);
                } catch (e) {
                    try {
                        warn('[match-round-summary] failed to render player', e);
                    } catch {
                    }
                }
            }
        }

        if (!players || !players.length) {
            try {
                debug('[match-round-summary] no per-player data found for round', {
                    round: r.round,
                    dataSource,
                    roundObj: r
                });
            } catch {
            }
        } else {
            try {
                debug('[match-round-summary] using per-player source', dataSource);
            } catch {
            }
        }

        (this as any)._rendered = true;
    }
});
export {};

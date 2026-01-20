/**
 * match-result-card.ts
 *
 * Small card used to display a player's summary in match result lists. Shows
 * name, basic stats and small badges for winner/loser or special elimination
 * reasons.
 */

import {isMarryReason} from "../core/reason-utils";
import {debug} from "../core/log";

customElements.define('match-result-card', class extends HTMLElement {
    private shadow: ShadowRoot;

    constructor() {
        super();
        this.shadow = this.attachShadow({mode: 'open'});
    }

    set player(v: any) {
        (this as any)._player = v;
        this.render();
    }

    connectedCallback() {
        if (!(this as any)._player) this.render();
    }

    render() {
        const p = (this as any)._player ?? {};
        const nameStr = String(p.username ?? p.userId ?? 'Unknown');
        const initial = (nameStr.trim()[0] ?? '?').toUpperCase();
        const uid = String(p.userId ?? '');

        // Primary sources (in priority order): explicit totalDamage fields on player, then stats.* fields
        const cand_p_totalOut = p?.totalDamageOut;
        const cand_p_statsOut = p?.stats?.damageOut ?? p?.stats?.totalDamageOut;

        const cand_p_totalIn = p?.totalDamageIn;
        const cand_p_statsIn = p?.stats?.damageIn ?? p?.stats?.totalDamageIn;

        const pickNonZero = (vals: Array<any>) => {
            for (const v of vals) {
                if (v == null) continue;
                const n = Number(v);
                if (!isNaN(n) && n !== 0) return n;
            }
            // if all are zero or missing, prefer explicit zeros if present in payload
            for (const v of vals) {
                if (v != null) {
                    const n = Number(v);
                    if (!isNaN(n)) return n;
                }
            }
            return 0;
        };

        const damageOut = pickNonZero([cand_p_totalOut, cand_p_statsOut]);
        const damageIn = pickNonZero([cand_p_totalIn, cand_p_statsIn]);

        try {
            debug('[match-result-card] resolved damage', {uid, damageOut, damageIn, p});
        } catch (e) {
        }

        const isWinner = p.isWinner === true || p.isWinner === 'true';
        const isLoser = p.isLoser === true || p.isLoser === 'true';
        const badge = isWinner ? ' 🏆' : (isLoser ? ' 💀' : '');
        // If the match ended due to a marry card (either proposal/refusal), show a ring emoji next to the badge
        const ring = isMarryReason(p.note, p.eliminationReason) ? ' 💍' : '';
        const color = p.color ?? '#e5e7eb';
        this.shadow.innerHTML = `
        <style>
          .card { background: white; padding: 12px; margin: 5px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.06); display:flex; align-items:center; justify-content:space-between }
          .meta { display:flex; gap:12px; align-items:center }
          .avatar { width:40px; height:40px; border-radius:50%; background:${color}; display:flex;align-items:center;justify-content:center;color:white; font-weight:600 }
          .name { font-weight:600 }
          .tiny { font-size:12px; color:#666 }
        </style>
        <div class="card">
          <div class="meta">
            <div class="avatar">${initial}</div>
            <div>
            <div class="name" style="color:${color}">${nameStr}${badge}${ring}</div>
              <div class="tiny">Rank: ${p.finalRank ?? '-'}</div>
            </div>
          </div>
          <div class="stats text-right">
            <div class="tiny">Damage dealt: ${damageOut}</div>
            <div class="tiny">Damage received: ${damageIn}</div>
          </div>
        </div>
        `;
    }
});
export {};

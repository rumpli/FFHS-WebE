/**
 * match-sidebar.ts
 *
 * Sidebar used inside match screens. Shows match stats and quick actions
 * (forfeit / end-round). Hooks into the app event bus to emit user actions.
 */

import {type MatchState, state} from "../core/store";
import {bus} from "../core/EventBus";
import {debug} from "../core/log";

class MatchSidebar extends HTMLElement {
    set match(m: MatchState) {
        this.render(m);
    }

    render(m: MatchState) {
        try {
            debug('[match-sidebar] render', {matchId: m.matchId, round: m.round});
        } catch (e) {
        }
        const phase = m.phase;
        const isFinished = phase === "finished";
        const opponent = (m.playersSummary || []).find((p) => p.userId !== state.userId) || null;
        let opponentBlock = "";
        const allowClientEndRound = ((import.meta as any).env?.VITE_ALLOW_CLIENT_END_ROUND === '1') || ((import.meta as any).env?.ALLOW_CLIENT_END_ROUND === '1');
        if (opponent) {
            opponentBlock = `
        <div class="border-t border-gray-100 pt-2 mt-2"></div>
        <div class="border-t border-gray-100 pt-2">
          <h3 class="text-sm font-semibold text-gray-800 mb-1">Actions</h3>
          <div class="flex flex-col gap-2">
            ${allowClientEndRound ? `<button id="btn-end-round" type="button" class="btn btn-primary text-xs" ${isFinished ? "disabled" : ""}>End Round</button>` : ``}
            <button id="btn-forfeit" type="button" class="btn btn-secondary text-xs" ${isFinished ? "disabled" : ""}>Forfeit</button>
          </div>
        </div>
      `;
        }
        const meSummary = Array.isArray(m.playersSummary) ? (m.playersSummary.find(p => String(p.userId) === String(state.userId)) ?? null) : null;
        const myDamageOut = Number(meSummary?.totalDamageOut ?? state.matchState?.totalDamageOut ?? (m.totalDamageOut ?? 0));
        const myDamageIn = Number(meSummary?.totalDamageIn ?? state.matchState?.totalDamageIn ?? (m.totalDamageIn ?? 0));
        this.innerHTML = `
      <aside class="card flex flex-col gap-3 text-xs">
        <div>
          <h3 class="text-sm font-semibold text-gray-800 mb-1">Match Stats</h3>
          <div class="space-y-1 text-gray-600">
            <div class="flex justify-between">
              <span>Damage to enemy Tower</span>
              <span class="font-mono">${myDamageOut}</span>
            </div>
            <div class="flex justify-between">
              <span>Damage taken by your Tower</span>
              <span class="font-mono">${myDamageIn}</span>
            </div>
           </div>
         </div>
         ${opponentBlock}
       </aside>
     `;
        try {
            const endBtn = this.querySelector('#btn-end-round') as HTMLButtonElement | null;
            if (endBtn) {
                debug('[match-sidebar] attaching end-round handler');
                endBtn.addEventListener('click', () => {
                    try {
                        debug('[match-sidebar] end-round clicked, matchId=', state.matchId);
                        try {
                            bus.emit('match:request-end-round', {matchId: state.matchId});
                        } catch (e) {
                        }
                    } catch (e) {
                        debug('[match-sidebar] end-round handler error', e);
                    }
                });
            }
            const forfeitBtn = this.querySelector('#btn-forfeit') as HTMLButtonElement | null;
            if (forfeitBtn) {
                debug('[match-sidebar] attaching forfeit handler');
                forfeitBtn.addEventListener('click', () => {
                    try {
                        debug('[match-sidebar] forfeit clicked, matchId=', state.matchId);
                        try {
                            bus.emit('match:request-forfeit', {matchId: state.matchId});
                        } catch (e) {
                        }
                    } catch (e) {
                        debug('[match-sidebar] forfeit handler error', e);
                    }
                });
            }
        } catch (e) {
        }
    }
}

customElements.define("match-sidebar", MatchSidebar);

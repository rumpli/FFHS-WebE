/**
 * match-vs-bar.ts
 *
 * Visual header for match screens showing both players' tower status, names,
 * HP bars and upgrade controls. Updates a timer element every second.
 */

import {state, type MatchState} from "../core/store";

class MatchVsBar extends HTMLElement {
    private timerInterval: number | null = null;

    set match(m: MatchState) {
        this.render(m);
    }

    connectedCallback() {
        if (this.timerInterval == null) {
            this.timerInterval = window.setInterval(() => this.updateTimer(), 1000);
        }
    }

    disconnectedCallback() {
        if (this.timerInterval != null) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    private updateTimer() {
        try {
            const el = this.querySelector("[data-role='round-timer']") as HTMLElement | null;
            if (!el) return;
            const now = Date.now();
            const tsAttr = el.getAttribute('data-ts');
            const ts = tsAttr ? Number(tsAttr) : state.matchState?.roundTimerTs ?? 0;
            if (!ts || Number.isNaN(ts)) {
                el.textContent = '—';
                return;
            }
            const diffMs = Math.max(0, ts - now);
            el.textContent = `${Math.ceil(diffMs / 1000)}s`;
        } catch (e) {
        }
    }

    render(m: MatchState) {
        const players = m.playersSummary || [];
        const me = players.find((p) => p.userId === state.userId) || null;
        const opp = players.find((p) => p.userId !== state.userId) || null;
        if (!me && !opp) {
            this.innerHTML = "";
            return;
        }
        const buildSprite = (color: "red" | "blue" | undefined, level?: number) => {
            const c = color === "red" ? "Red" : "Blue";
            const lvl = level ?? 1;
            const tier = lvl >= 5 ? 3 : lvl >= 3 ? 2 : 1;
            return `/assets/${c}Tower${tier}.png`;
        };
        const mySprite = buildSprite(m.towerColor, m.towerLevel);
        const oppSprite = opp ? buildSprite(opp.towerColor as "red" | "blue" | undefined, opp.towerLevel) : null;
        const myName = me?.username ?? "You";
        const oppName = opp?.username ?? "Opponent";
        const myHp = Math.max(0, m.towerHp);
        const myHpMax = Math.max(1, m.towerHpMax);
        const myHpPct = Math.max(0, Math.min(100, (myHp / myHpMax) * 100));
        const oppHp = opp ? Math.max(0, opp.towerHp) : 0;
        const oppHpMax = opp ? Math.max(1, ((opp.towerHpMax ?? opp.towerHp) || 1)) : 1;
        const oppHpPct = opp ? Math.max(0, Math.min(100, (oppHp / oppHpMax) * 100)) : 0;
        const hasUpgradeCost = typeof m.towerUpgradeCost === "number" && m.towerUpgradeCost >= 0;
        const upgradeCost = hasUpgradeCost ? m.towerUpgradeCost! : undefined;
        const canUpgrade = !!state.matchId && hasUpgradeCost && m.gold >= (upgradeCost ?? 0);
        const myDpsRaw = (m.towerDps ?? state.matchState?.towerDps) ?? null;
        const myDpsDisplay = (myDpsRaw != null && !Number.isNaN(Number(myDpsRaw)))
            ? (Math.abs((myDpsRaw as number) % 1) < 1e-9 ? String(Math.round(myDpsRaw as number)) : (myDpsRaw as number).toFixed(1))
            : '—';

        this.innerHTML = `
 <section class="w-full px-4 mt-1 relative vs-bar-section">
   <div class="w-full max-w-5xl mx-auto rounded-xl bg-white/70 border border-gray-100 pl-0 pr-3 py-1.5 vs-bar-content text-[11px] relative">
     <div class="vs-left flex items-center gap-2 min-w-0">
       <div class="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center overflow-hidden">
         <img src="${mySprite}" alt="Your tower" class="w-full h-full object-contain" />
       </div>
       <div class="min-w-0">
         <div class="truncate font-semibold text-gray-800">${myName} 
            <span class="text-[10px] text-gray-500 vs-level" style="display:inline-block">Lv ${m.towerLevel}</span>          
            <span class="text-[10px] text-gray-500 mt-0.5"> / T-DPS ${myDpsDisplay}</span>
            </div>
          <div class="mt-0.5 w-28 h-1.5 bg-gray-200 rounded-full overflow-hidden relative">
            <div class="h-full bg-emerald-500 rounded-2xl" style="width: ${myHpPct}%;"></div>
            <div class="hpbar-label right-1">${Math.round(myHpPct)}%</div>
          </div>
          <div class="hp-numeric text-[10px] text-gray-500 mt-0.5">HP ${myHp} / ${myHpMax}</div>
       </div>
      <button
          id="btn-tower-upgrade"
          type="button"
          class="inline-flex items-center gap-1 rounded-full border px-2 py-1 ml-2 text-[10px] ${canUpgrade ? "bg-amber-500 border-amber-600 text-white shadow-sm hover:bg-amber-600" : "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"}"
          ${canUpgrade ? "" : "disabled"}
          ${hasUpgradeCost ? `title=\"Upgrade tower (cost ${upgradeCost} gold)\"` : ""}
        >
          <span class="upgrade-label font-semibold">Upgrade</span>
          <!-- Inline SVG arrow (hidden on desktop, shown on mobile via CSS). Using stroke chevron for crispness. -->
          <svg class="upgrade-arrow" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 15l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          ${hasUpgradeCost
            ? `<span class="inline-flex items-center gap-0.5 text-[10px] upgrade-cost-wrapper">
                    <span class="inline-block w-3 h-3 rounded-full bg-amber-400 border border-amber-500"></span>
                    <span class="upgrade-cost-number font-semibold">${upgradeCost}</span>
                  </span>`
            : ""}
        </button>
     </div>
     <div class="vs-center">
      <div class="vs-main-label text-[10px] text-gray-400 font-semibold px-2 bg-white/80 rounded shadow">VS</div>
      <div class="vs-center-extra z-20 hidden mt-1">
        <div class="pill pill-ok">Round <span class="font-semibold ml-1">${m.round ?? 0}</span></div>
        <div class="pill"><span class="font-semibold ml-1">${m.gold ?? 0}</span> <span class="align-middle inline-block w-3 h-3 rounded-full bg-amber-400 border border-amber-500"></span></div>
        <div class="pill">Timer <span class="font-semibold ml-1" data-role="round-timer" data-ts="${m.roundTimerTs ?? 0}">${m.roundTimerTs ? Math.max(0, Math.ceil((m.roundTimerTs - Date.now()) / 1000)) : '—'}s</span></div>
      </div>
     </div>
     <div class="vs-right flex items-center gap-2 min-w-0" style="justify-self:end;">
       ${oppSprite
            ? `<div class="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center overflow-hidden">
                <img src="${oppSprite}" alt="Opponent tower" class="w-full h-full object-contain" />
              </div>`
            : ""}
       <div class="min-w-0">
         <div class="truncate font-semibold text-gray-800">${opp ? `${oppName} <span class=\"text-[10px] text-gray-500\">Lv ${opp.towerLevel ?? 1}</span>` : ""}</div>
          <div class="mt-0.5 w-28 h-1.5 bg-gray-200 rounded-full ml-auto relative">
            <div class="h-full bg-rose-500 rounded-2xl" style="width: ${oppHpPct}%;"></div>
            <div class="hpbar-label right-1">${Math.round(oppHpPct)}%</div>
          </div>
          <div class="hp-numeric text-[10px] text-gray-500 mt-0.5">HP ${oppHp} / ${oppHpMax}</div>
       </div>
     </div>
   </div>
 </section>`;
        this.updateTimer();
    }
}

customElements.define("match-vs-bar", MatchVsBar);


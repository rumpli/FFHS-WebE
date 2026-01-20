/**
 * match-header.ts
 *
 * Header bar for match screens showing round, gold and optional round timer.
 */

import {type MatchState} from "../core/store";

class MatchHeader extends HTMLElement {
    set match(m: MatchState) {
        this.render(m);
    }

    render(m: MatchState) {
        let timerLabel = "";
        if (typeof m.roundTimerTs === "number" && m.roundTimerTs > 0) {
            const now = Date.now();
            const diffMs = Math.max(0, m.roundTimerTs - now);
            const secs = Math.ceil(diffMs / 1000);
            timerLabel = `${secs}s`;
        }
        this.innerHTML = `
<header class="w-full h-14 px-4 pt-3">
  <div class="w-full max-w-5xl mx-auto flex items-center justify-end gap-3">
    <div class="flex items-center gap-3 text-xs">
      <div class="pill pill-ok">
        Round <span class="font-semibold ml-1">${m.round}</span>
      </div>
      <div class="pill">
        <span class="font-semibold ml-1">${m.gold}</span>
        <span class="inline-block w-3 h-3 rounded-full bg-amber-400 border border-amber-500"></span>
      </div>
      ${timerLabel
            ? `<div class="pill pill-warn" title="Time left in this shop phase">
               Timer <span class="font-semibold ml-1" data-role="round-timer">${timerLabel}</span>
             </div>`
            : ""}
    </div>
  </div>
</header>`;
    }
}

customElements.define("match-header", MatchHeader);

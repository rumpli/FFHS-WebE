/**
 * match-board.ts
 ** Visual representation of the match board. Renders up to 7 slots and
 * delegates rendering of individual cards to the `match-card` component.
 */

import {type MatchState} from "../core/store";

class MatchBoard extends HTMLElement {
    set match(m: MatchState) {
        this.render(m);
    }

    render(m: MatchState) {
        this.innerHTML = `
      <section class="card flex flex-col gap-3 mt-1">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-semibold text-gray-700">Board</span>
          <span class="text-[10px] text-gray-400">Up to 7 slots • each slot holds a single card</span>
        </div>
        <div class="grid grid-cols-7 gap-2" data-role="board-grid">
          ${this.renderBoardRow(m)}
        </div>
      </section>
    `;
    }

    renderBoardRow(m: MatchState): string {
        const getCardById = (window as any).getCardById || (() => null);
        const slots = Array.isArray(m.boardSlots) ? m.boardSlots : [];
        return slots
            .map((slot: any, index: number) => {
                const card = slot.cardId ? getCardById(slot.cardId) : null;
                if (!card) {
                    const svg = `<svg width="96" height="76" viewBox="0 0 300 236" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
  <rect x="6" y="6" width="288" height="224" rx="14" fill="#f8fafc" stroke="#e5e7eb" />
  <text x="150" y="118" text-anchor="middle" dominant-baseline="middle" font-family="system-ui" font-size="14" fill="#9ca3af">Empty</text>
</svg>`;
                    return `
<button data-zone="board" data-index="${index}" class="board-card-wrapper board-card-empty" type="button">
  <div class="match-card-svg-container">
    ${svg}
  </div>
</button>`;
                }
                const typeLabel = card.type.charAt(0).toUpperCase() + card.type.slice(1);
                const imageUrl = card.image || "/assets/placeholder.png";
                return `
<match-card card-id="${card.id}"
            name="${card.name}"
            cost="${card.cost}"
            image="${imageUrl}"
            type="${typeLabel}"
            rarity="${card.rarity}"
            stack-count="${slot.stackCount ?? 0}"
            data-zone="board"
            data-index="${index}"
            class="board-card-wrapper"></match-card>`;
            })
            .join("");
    }
}

customElements.define("match-board", MatchBoard);

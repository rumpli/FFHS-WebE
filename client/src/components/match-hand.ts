/**
 * match-hand.ts
 *
 * Displays the player's hand, deck/discard counts and provides helpers to show
 * transient UI hints (hand-full badge) used by drag-and-drop behaviour.
 */

import {type MatchState} from "../core/store";

class MatchHand extends HTMLElement {
    set match(m: MatchState) {
        this.render(m);
    }

    render(m: MatchState) {
        const deckCount = (m.deckIds || []).length;
        const discardCount = (m.discardIds || []).length;
        this.innerHTML = `
<section class="card flex flex-col gap-3 mt-1" data-role="hand-area">
  <div class="flex items-center justify-between mb-1">
    <h2 class="text-sm font-semibold text-gray-800">Hand</h2>
    <div class="flex items-center gap-2 text-[10px] text-gray-400">
      <span class="inline-flex items-center gap-1" title="Cards left in deck">
        <span class="w-2 h-2 rounded-full bg-blue-400"></span>
        Deck: <span class="font-semibold text-gray-600">${deckCount}</span>
      </span>
      <span class="inline-flex items-center gap-1" title="Cards in discard (will reshuffle into deck when empty)">
        <span class="w-2 h-2 rounded-full bg-gray-400"></span>
        Discard: <span class="font-semibold text-gray-600">${discardCount}</span>
      </span>
    </div>
  </div>
  <div class="flex gap-2 overflow-x-auto pb-1 items-center justify-center w-full" data-role="hand-strip">
    ${this.renderHandRow(m)}
  </div>
</section>`;
    }

    renderHandRow(m: MatchState): string {
        const getCardById = (id: string) => (window as any).getCardById?.(id) || null;
        const ids = Array.isArray(m.handIds) ? m.handIds : [];
        const row = ids
            .map((id: string, idx: number) => {
                const card = getCardById(id);
                if (!card) return "";
                const typeLabel = card.type.charAt(0).toUpperCase() + card.type.slice(1);
                const stats = card.stats || "";
                const imageUrl = card.image || "/assets/placeholder.png";
                const notEnough = (m.gold ?? 0) < (card.cost ?? 0);
                return `
<match-card card-id="${card.id}"
            name="${card.name}"
            cost="${card.cost}"
            image="${imageUrl}"
            type="${typeLabel}"
            rarity="${card.rarity}"
            stats="${stats}"
            ${notEnough ? 'not-enough' : ''}
            data-card-id="${card.id}"
            data-hand-index="${idx}"
            data-context="hand"
            class="hand-card-wrapper ${notEnough ? 'card-disabled' : ''}"></match-card>`;
            })
            .join("");

        // If there are no visible cards, render a hidden placeholder that
        // reserves the same size as a compact hand card so the hand border
        // doesn't collapse. The placeholder is invisible (no visual content).
        if (!row.trim()) {
            return `<div class="hand-empty-placeholder" aria-hidden="true"></div>`;
        }
        return row;
    }

    showDropHighlight(hint: string) {
        const area = this.querySelector('[data-role="hand-area"]') as HTMLElement | null;
        if (area) {
            area.classList.add('hand-drop-highlight');
            area.setAttribute('data-drop-hint', hint);
        }
    }

    clearDropHighlight() {
        const area = this.querySelector('[data-role="hand-area"]') as HTMLElement | null;
        if (area) {
            area.classList.remove('hand-drop-highlight');
            area.removeAttribute('data-drop-hint');
        }
    }

    // Show a transient "Hand full" badge positioned over the hand area. We
    // append the badge to document.body (fixed positioning) so it's not removed
    // when this element re-renders its innerHTML.
    public showHandFull(durationMs = 1500) {
        try {
            // Remove any leftover badge(s) to avoid duplicates created by races.
            try {
                // remove any previous badges (global or inline) to avoid duplicates
                const prev = Array.from(document.querySelectorAll('.hand-full-badge-global, .hand-full-badge')) as HTMLElement[];
                for (const n of prev) {
                    try {
                        const iv: any = (n as any)._handFullReposition;
                        if (iv) clearInterval(iv);
                        const to: any = (n as any)._handFullTimeout;
                        if (to) clearTimeout(to);
                        n.remove();
                    } catch (e) {
                    }
                }
            } catch (e) {
            }

            // Create a fresh badge and position it over the hand area.
            const badge = document.createElement('div');
            badge.className = 'hand-full-badge-global hand-full-badge px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs border border-yellow-200';
            badge.textContent = 'Hand full';
            badge.style.position = 'fixed';
            badge.style.zIndex = '9999';
            badge.style.pointerEvents = 'none';
            badge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)';
            badge.style.transform = 'translateX(-50%)';
            // Safe initial placement to avoid a brief top-left flash
            badge.style.left = '50%';
            badge.style.bottom = '84px';
            badge.style.minWidth = '72px';
            badge.style.minHeight = '28px';
            badge.style.lineHeight = '20px';

            const positionBadge = () => {
                try {
                    const area = this.querySelector('[data-role="hand-area"]') as HTMLElement | null;
                    if (area) {
                        const r = area.getBoundingClientRect();
                        const cx = r.left + r.width / 2;
                        const ty = Math.max(8, r.top - 18);
                        badge.style.left = `${cx}px`;
                        badge.style.top = `${ty}px`;
                        badge.style.removeProperty('bottom');
                    } else {
                        badge.style.left = '50%';
                        badge.style.bottom = '84px';
                        badge.style.removeProperty('top');
                    }
                } catch (e) {
                }
            };

            positionBadge();
            badge.style.opacity = '0';
            document.body.append(badge);
            void badge.offsetWidth;
            badge.style.transition = 'opacity 0.2s ease-out';
            badge.style.opacity = '1';

            (badge as any)._handFullTimeout = setTimeout(() => {
                try {
                    badge.style.transition = 'opacity 0.5s ease-in';
                    badge.style.opacity = '0';
                    (badge as any)._handFullReposition = setTimeout(() => {
                        try {
                            badge.remove();
                        } catch (e) {
                        }
                    }, 500);
                } catch (e) {
                }
            }, durationMs);
        } catch (e) {
        }
    }
}

export default MatchHand;
customElements.define("match-hand", MatchHand);

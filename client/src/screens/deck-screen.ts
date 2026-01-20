/**
 * deck-screen.ts
 *
 * Renders the user's available decks and allows selecting a deck to play.
 * Exposes `setDeck` to programmatically set the active deck contents.
 */

import {state} from "../core/store";
import type {SharedDeck, SharedDeckCard} from "../../../shared/types/deck";

let availableDecks: SharedDeck[] = [];

customElements.define(
    "deck-screen",
    class extends HTMLElement {
        private cards: SharedDeckCard[] = [];
        private selectedDeckId: string | null = null;

        connectedCallback() {
            this.loadDecks().then(() => this.render());
        }

        private async loadDecks() {
            const API = (window as any).__CFG__?.API_URL;
            if (!API) {
                this.cards = [];
                return;
            }

            try {
                const res = await fetch(`${API}/decks`, {
                    headers: state.userId
                        ? {Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}`}
                        : {},
                });
                if (!res.ok) {
                    this.cards = [];
                    return;
                }

                const data = await res.json();
                availableDecks = Array.isArray(data.decks) ? (data.decks as SharedDeck[]) : [];
                const first = availableDecks[0];
                this.selectedDeckId = first?.id ?? null;
                this.cards = first?.cards ?? [];
            } catch {
                this.cards = [];
            }
        }

        private render() {
            this.innerHTML = `
<div class="screens vh-100">
    
      <div class="home-center center-content">
    
        <!-- Header -->
        <header class="w-full max-w-md flex items-center justify-between mb-2">
          <h1 class="text-lg font-semibold text-gray-800">Your Deck</h1>
          <span class="text-xs text-gray-500">
            ${this.cards.length} card types
          </span>
        </header>
    
        <!-- Deck selector dropdown (scales well for many decks) -->
        <div class="w-full max-w-md mb-2">
          <label for="deck-select" class="sr-only">Select deck</label>
          <select id="deck-select" class="w-full input">
            <option value="" disabled ${this.selectedDeckId ? '' : 'selected'}>Select a deck</option>
            ${availableDecks
                .map((d) => `<option value="${d.id}" ${d.id === this.selectedDeckId ? 'selected' : ''}>${d.name} (${(d.cards || []).length} cards)</option>`)
                .join('')}
          </select>
        </div>
    
        <!-- Description -->
        <p class="w-full max-w-md text-xs text-gray-500 text-left mb-1">
          This is the deck you'll use in the next match. You can adjust it in the Collection screen.
        </p>
    
        <!-- Deck table -->
        <section class="w-full max-w-md bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
          <table class="w-full text-left text-sm">
            <thead class="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th class="px-3 py-2">Card</th>
                <th class="px-3 py-2">Type</th>
                <th class="px-3 py-2 text-center">Lvl</th>
                <th class="px-3 py-2 text-center">Copies</th>
              </tr>
            </thead>
            <tbody>
              ${this.cards
                .map(
                    (c) => `
                <tr class="border-t border-gray-100">
                  <td class="px-3 py-2 text-gray-800">${c.name}</td>
                  <td class="px-3 py-2 text-gray-500">${c.type}</td>
                  <td class="px-3 py-2 text-center text-gray-700">${c.level}</td>
                  <td class="px-3 py-2 text-center text-gray-700">${c.copies}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </section>
    
        <!-- Actions -->
        <div class="w-full max-w-md mt-1 flex items-center justify-between gap-2 button-wrapper">
          <button id="btn-back" type="button" class="btn btn-secondary">
            Back
          </button>
          <button id="btn-play-next" type="button" class="btn btn-primary">
             Play
           </button>
         </div>
      </div>
    
      <!-- HUD / footer -->
      <app-footer></app-footer>
</div>
`;
            this.bind();
        }

        private $(sel: string) {
            return this.querySelector(sel) as HTMLElement | null;
        }

        private bind() {
            this.$("#btn-back")?.addEventListener("click", () => {
                this.dispatchEvent(
                    new CustomEvent("nav:back", {bubbles: true})
                );
            });

            this.$("#btn-play-next")?.addEventListener("click", () => {
                this.dispatchEvent(
                    new CustomEvent("deck:play", {
                        bubbles: true,
                        detail: {deckId: this.selectedDeckId},
                    })
                );
            });

            const deckSelect = this.$('#deck-select') as HTMLSelectElement | null;
            if (deckSelect) {
                deckSelect.addEventListener('change', () => {
                    const deckId = deckSelect.value || null;
                    if (!deckId) return;
                    const deck = availableDecks.find((d) => d.id === deckId);
                    if (!deck) return;
                    this.selectedDeckId = deck.id;
                    this.cards = deck.cards;
                    this.render();
                });
            }
        }

        public setDeck(cards: SharedDeckCard[]) {
            this.cards = cards;
            this.render();
        }
    }
);

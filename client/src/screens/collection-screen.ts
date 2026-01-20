/**
 * collection-screen.ts
 *
 * Displays the player's card collection with search, filters and paging.
 * Allows opening a detailed card modal and handles UI interactions for the
 * collection view. This file provides a web component registered as
 * `<collection-screen>`.
 */

import "../ui/avatar-button";
import "../ui/shop-button";
import "../components/app-footer";
import "../ui/card/tl-card";

import type {MatchCard} from "../ui/types/card-types";
import {debug, error, warn} from "../core/log";
import {buildStats} from "../ui/card/card-utils";

const PAGE_SIZE = 8;

type CollectionCard = MatchCard & {
    level: number;
    owned: number;
};

customElements.define(
    "collection-screen",
    class extends HTMLElement {
        private cards: CollectionCard[] = [];
        private allCards: CollectionCard[] = [];
        private filtered: CollectionCard[] = [];
        private activeFilter: CollectionCard["type"] | "all" = "all";
        private page = 0;
        private loadError: string | null = null;
        private searchTerm = "";
        private shouldRefocusSearch = false;

        connectedCallback() {
            void this.load();
        }

        private async load() {
            try {
                const API = (window as any).__CFG__.API_URL;
                const res = await fetch(`${API}/cards`);
                const data = await res.json().catch(() => null);

                if (!res.ok || !data?.ok || !Array.isArray(data.cards)) {
                    const serverMsg = "Failed to load cards";
                    error(serverMsg, {status: res.status, data});
                    this.cards = [];
                    this.filtered = [];
                    this.allCards = [];
                    this.loadError = serverMsg;
                    this.render();
                    return;
                }

                const all = data.cards.map((c: any): CollectionCard => ({
                    id: c.id,
                    name: c.name,
                    description: c.description ?? "",
                    type: (typeof c.type === "string" ? c.type.toLowerCase() : "attack") as CollectionCard["type"],
                    rarity: c.rarity ?? "common",
                    image: c.image ?? "",
                    cost: c.cost ?? 0,
                    baseDamage: c.baseDamage ?? null,
                    baseHpBonus: c.baseHpBonus ?? null,
                    baseDpsBonus: c.baseDpsBonus ?? null,
                    economyBonus: c.economyBonus ?? null,
                    buffMultiplier: c.buffMultiplier ?? null,
                    config: c.config ?? {},
                    level: 1,
                    owned: 0,
                    // optional: carry collectible from backend (default true)
                    // @ts-ignore if not in type
                    collectible: c.collectible ?? true,
                }));

                this.allCards = all;
                debug("[collection-screen] loaded cards:", this.allCards.map(c => c.id));

                // Only show collectible ones in the grid
                // @ts-ignore – if collectible isn't in CollectionCard, you can define it there
                this.cards = all.filter((c: any) => c.collectible !== false);

                this.filtered = this.cards;
                this.loadError = null;
                this.render();
            } catch (e) {
                error("Failed to load cards", e);
                this.cards = [];
                this.filtered = [];
                this.allCards = [];
                this.loadError = "Unable to load cards.";
                this.render();
            }
        }


        private openCardDetail(card: CollectionCard) {
            const overlay = document.createElement("div");
            overlay.className = "card-detail-overlay";

            const inner = document.createElement("div");
            inner.className = "card-detail-inner";

            const main = document.createElement("tl-card");
            main.setAttribute("name", card.name);
            main.setAttribute("cost", String(card.cost));
            main.setAttribute("type", card.type);
            main.setAttribute("rarity", card.rarity);
            main.setAttribute("image", card.image);
            main.setAttribute("description", card.description);
            main.setAttribute("stats", buildStats(card));
            main.classList.add("detail-card");

            const target = String((card.config as any)?.target ?? "").toLowerCase();

            if (target === "marry_proposal") {
                const spawnId =
                    (card.config as any).spawnCardId ?? "marry_refusal";

                const pool = (this.allCards && this.allCards.length > 0)
                    ? this.allCards
                    : this.cards;

                const spawned = pool.find((c) => c.id === spawnId);

                if (!spawned) {
                    warn("Spawn card not found", {spawnId, poolSize: pool.length});
                    inner.appendChild(main);
                } else {
                    const stack = document.createElement("div");
                    stack.className = "card-detail-stack ultimatum-stack";
                    main.classList.add("detail-card-front");

                    const spawnedEl = document.createElement("tl-card");
                    spawnedEl.setAttribute("name", spawned.name);
                    spawnedEl.setAttribute("cost", String(spawned.cost));
                    spawnedEl.setAttribute("type", spawned.type);
                    spawnedEl.setAttribute("rarity", spawned.rarity);
                    spawnedEl.setAttribute("image", spawned.image);
                    spawnedEl.setAttribute("description", spawned.description);
                    spawnedEl.setAttribute("stats", buildStats(spawned));
                    spawnedEl.classList.add("detail-card", "detail-card-back", "refusal-card");

                    stack.appendChild(main);
                    stack.appendChild(spawnedEl);
                    inner.appendChild(stack);

                    const label = document.createElement("div");
                    label.className = "linked-card-label";
                    label.textContent = "Refusal lurks behind. Tap a card to reveal who takes the stage.";
                    inner.appendChild(label);

                    stack.addEventListener("click", (ev) => {
                        const target = ev.target as HTMLElement | null;
                        if (!target?.closest("tl-card")) return;
                        stack.classList.toggle("swapped");
                    });
                }

                inner.classList.add("ultimatum-detail");
            } else {
                inner.appendChild(main);
            }

            overlay.appendChild(inner);

            overlay.addEventListener("click", (ev) => {
                if (ev.target === overlay) {
                    overlay.remove();
                }
            });

            const onKey = (ev: KeyboardEvent) => {
                if (ev.key === "Escape") {
                    overlay.remove();
                    window.removeEventListener("keydown", onKey);
                }
            };
            window.addEventListener("keydown", onKey);

            document.body.appendChild(overlay);
        }


        private render() {
            const totalPages = Math.max(1, Math.ceil(this.filtered.length / PAGE_SIZE));
            if (this.page > totalPages - 1) this.page = totalPages - 1;
            if (this.page < 0) this.page = 0;

            const pageCards = this.filtered.slice(
                this.page * PAGE_SIZE,
                this.page * PAGE_SIZE + PAGE_SIZE
            );

            const isEmpty = this.filtered.length === 0;

            const placeholderCount = isEmpty
                ? PAGE_SIZE
                : Math.max(0, PAGE_SIZE - pageCards.length);

            const FILTERS: Array<CollectionCard["type"] | "all"> = [
                "all",
                "attack",
                "defense",
                "buff",
                "economy",
            ];

            this.innerHTML = `
<div class="screens vh-100">

  <div class="home-center center-content collection-screen">

    <h1 class="text-lg font-semibold text-gray-800 mb-2">Collection</h1>

    <p class="w-full max-w-md text-xs text-gray-500 mb-2">
      Browse your cards, search or filter by category.
    </p>

    ${
                this.loadError
                    ? `<div class="w-full max-w-md text-xs text-red-600 mb-2">${this.loadError}</div>`
                    : ""
            }

    <!-- search -->
    <div class="w-full max-w-md mb-2">
      <div class="field search-field">
        <div class="field-inner">
          <input id="search" class="field-input" placeholder=" " value="${this.searchTerm}"/>
          <label for="search" class="field-label">Search</label>
        </div>
      </div>
    </div>

    <!-- filters -->
    <div class="card-filter-selection">
        ${FILTERS
                .map((t) => {
                    const label = t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1);
                    const isActive = this.activeFilter === t;
                    return `
        <button
          data-filter="${t}"
          class="pill collection-filter ${isActive ? "pill-ok active-filter" : ""}">
          ${label}
        </button>`;
                })
                .join("")}
    </div>

     <!-- paged card grid + overlay -->
    <div class="card-page-grid-wrapper">
      <div class="card-page-grid">
        ${
                isEmpty
                    ? Array.from({length: placeholderCount})
                        .map(
                            () => `
            <tl-card
              class="placeholder-card"
              name=""
              cost="0"
              type="attack"
              rarity="common"
              image=""
              description=""
              stats="">
            </tl-card>
          `
                        )
                        .join("")
                    : `
          ${pageCards
                        .map(
                            (c) => `
            <tl-card
              data-card-id="${c.id}"
              name="${c.name}"
              cost="${c.cost}"
              type="${c.type}"
              rarity="${c.rarity}"
              image="${c.image}"
              description="${c.description}"
              stats="${buildStats(c)}">
            </tl-card>
          `
                        )
                        .join("")}
          ${Array.from({length: placeholderCount})
                        .map(
                            () => `
            <tl-card
              class="placeholder-card"
              name=""
              cost="0"
              type="attack"
              rarity="common"
              image=""
              description=""
              stats="">
            </tl-card>
          `
                        )
                        .join("")}
        `
            }
      </div>

      ${
                isEmpty && !this.loadError
                    ? `
        <div class="card-empty-msg">
          No cards match your filters.
        </div>
      `
                    : ""
            }
    </div>

     <!-- page controls -->
    <div class="card-page-controls w-full max-w-4xl mx-auto mt-2 flex items-center">
      <span class="ml-auto text-xs text-gray-500">
        Page ${Math.min(this.page + 1, totalPages)} / ${totalPages}
      </span>
    </div>

  </div>
    <!-- Left arrow -->
    <button
        id="prev"
        class="btn btn-primary btn-arrow card-page-control-l ${this.page === 0 ? "btn-disabled" : ""}"
        ${this.page === 0 ? "disabled" : ""}>
            &#x25C0;
    </button>
    
    <!-- Right arrow -->
    <button
        id="next"
        class="btn btn-primary btn-arrow card-page-control-r ${this.page >= totalPages - 1 ? "btn-disabled" : ""}"
        ${this.page >= totalPages - 1 ? "disabled" : ""}>
            &#x25B6;
    </button>

  <button id="btn-back" class="btn btn-secondary btn-bot-ml">Back</button>
  <button id="btn-to-deck" class="btn btn-primary btn-bot-r mr-10">Play</button>
  <tl-avatar-button></tl-avatar-button>
  <tl-shop-button></tl-shop-button>
  <app-footer></app-footer>
</div>
`;
            this.bind();
        }

        private bind() {
            this.$("#btn-back")?.addEventListener("click", () => {
                this.dispatchEvent(new CustomEvent("nav:back", {bubbles: true}));
            });

            this.$("#btn-to-deck")?.addEventListener("click", () => {
                this.dispatchEvent(new CustomEvent("nav:deck", {bubbles: true}));
            });

            const search = this.$("#search") as HTMLInputElement | null;
            search?.addEventListener("input", (e) => {
                this.searchTerm = (e.target as HTMLInputElement).value;
                this.shouldRefocusSearch = true;
                this.applyFilters();
            });

            this.querySelectorAll<HTMLButtonElement>(".collection-filter").forEach((btn) => {
                btn.addEventListener("click", () => {
                    this.activeFilter = btn.dataset.filter as CollectionCard["type"] | "all";
                    this.page = 0;
                    this.applyFilters();
                });
            });

            this.$("#prev")?.addEventListener("click", () => {
                if (this.page > 0) {
                    this.page--;
                    this.render();
                }
            });

            this.$("#next")?.addEventListener("click", () => {
                const totalPages = Math.ceil(this.filtered.length / PAGE_SIZE) || 1;
                if (this.page < totalPages - 1) {
                    this.page++;
                    this.render();
                }
            });

            const grid = this.$(".card-page-grid") as HTMLElement | null;
            grid?.addEventListener("click", (e) => {
                const target = e.target as HTMLElement | null;
                if (!target) return;

                const cardEl = target.closest("tl-card") as HTMLElement | null;
                if (!cardEl) return;
                if (cardEl.classList.contains("placeholder-card")) return;

                const insideControl =
                    (target.closest("button, a") as HTMLElement | null) !== null;
                if (insideControl) return;

                const cardId = cardEl.getAttribute("data-card-id");
                if (!cardId) return;

                const card = this.cards.find((c) => c.id === cardId);
                if (!card) return;

                this.openCardDetail(card);
            });

            if (this.shouldRefocusSearch) {
                const search = this.$("#search") as HTMLInputElement | null;
                if (search) {
                    search.focus();
                    const len = search.value.length;
                    search.setSelectionRange(len, len);
                }
                this.shouldRefocusSearch = false;
            }
        }

        private applyFilters() {
            const term = this.searchTerm.toLowerCase().trim();

            this.filtered = this.cards.filter((c) => {
                const filterOK =
                    this.activeFilter === "all" || c.type === this.activeFilter;
                const searchOK =
                    !term ||
                    c.name.toLowerCase().includes(term) ||
                    c.description.toLowerCase().includes(term);
                return filterOK && searchOK;
            });

            this.page = 0;
            this.render();
        }

        private $(sel: string) {
            return this.querySelector(sel) as HTMLElement | null;
        }
    }
);
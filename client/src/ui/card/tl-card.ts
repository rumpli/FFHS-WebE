/**
 * tl-card.ts
 *
 * Lightweight custom element that renders a card using the `createCardSVG`
 * helper. The element maps a few attributes (`name`, `cost`, `rarity`,
 * `description`, `stats`, `image`, `type`) directly into the SVG template.
 */

import {createCardSVG} from "./card-template";

/**
 * `TLCard` is a small wrapper around `createCardSVG` that responds to
 * attribute changes and re-renders the SVG. It's intended to be used as
 * `<tl-card ...attributes />` in templates.
 */
export class TLCard extends HTMLElement {
    static get observedAttributes() {
        return ["name", "cost", "rarity", "description", "stats", "image", "type"];
    }

    private data: Record<string, string> & {
        rarity?: string;
        type?: string;
    } = {};

    connectedCallback() {
        this.render();
    }

    attributeChangedCallback(attr: string, _old: string | null, value: string | null) {
        if (value == null) return;
        this.data[attr] = value;
        this.render();
    }

    private render() {
        const rawType = (this.data.type ?? "attack").toLowerCase();
        const type = (["attack", "defense", "buff", "economy"].includes(rawType)
            ? rawType
            : "attack") as "attack" | "defense" | "buff" | "economy";

        const rawRarity = (this.data.rarity ?? "common").toLowerCase();
        const rarity = (["common", "uncommon", "rare", "epic", "legendary"].includes(rawRarity)
            ? rawRarity
            : "common") as "common" | "uncommon" | "rare" | "epic" | "legendary";

        const rarityRank: Record<typeof rarity, number> = {
            common: 0,
            uncommon: 1,
            rare: 2,
            epic: 3,
            legendary: 4,
        };

        const rank = rarityRank[rarity] ?? 0;
        const isEpicPlus = rank >= 3;
        const glowClass = isEpicPlus ? "card-glow" : "";

        const svg = createCardSVG({
            name: this.data.name ?? "",
            cost: this.data.cost ?? "0",
            rarity,
            description: this.data.description ?? "",
            stats: this.data.stats ?? "",
            image: this.data.image ?? "",
            type,
        });

        this.innerHTML = `
  <div class="card-wrapper ${glowClass}" data-rarity="${rarity}">
    ${svg}
  </div>
`;
    }
}

customElements.define("tl-card", TLCard);
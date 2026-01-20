/**
 * match-card.ts
 *
 * Lightweight wrapper that renders a card's SVG tile. Accepts attributes like
 * `card-id`, `name`, `cost`, `image`, `type`, `rarity` and `stats` and updates
 * the rendered tile when attributes change.
 */

import {createCardSVG} from "../ui/card/card-template";
import {error} from "../core/log";

class MatchCard extends HTMLElement {
    static get observedAttributes() {
        return [
            'card-id', 'name', 'cost', 'image', 'type', 'rarity', 'stats', 'not-enough', 'stack-count', 'context', 'hand-index', 'data-zone', 'data-index', 'data-card-id'
        ];
    }

    connectedCallback() {
        this.render();
    }

    attributeChangedCallback() {
        this.render();
    }

    private escape(s: unknown) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    render() {
        const cardId = this.getAttribute('card-id');
        const name = this.getAttribute('name') ?? '';
        const costRaw = this.getAttribute('cost') ?? '';
        const cost = Number(costRaw) || costRaw || 0;
        const image = this.getAttribute('image') ?? '/assets/placeholder.png';
        const typeRaw = this.getAttribute('type') ?? '';
        const rarityRaw = this.getAttribute('rarity') ?? '';
        const stats = this.getAttribute('stats') ?? '';
        const notEnough = this.hasAttribute('not-enough');
        const stackCount = Number(this.getAttribute('stack-count') ?? 0) || 0;

        const passthroughAttrs: string[] = [];
        for (const attr of Array.from(this.attributes)) {
            const n = attr.name;
            if (
                ['card-id', 'name', 'cost', 'image', 'type', 'rarity', 'stats', 'not-enough', 'stack-count'].includes(n)
            ) continue;
            passthroughAttrs.push(`${n}="${this.escape(attr.value)}"`);
        }

        const typeKey = String(typeRaw).toLowerCase();
        const rarityKey = String(rarityRaw).toLowerCase();
        const contextAttr = this.getAttribute('data-context') ?? this.getAttribute('data-zone') ?? '';
        const explicitCompact = this.hasAttribute('compact');
        const compact = explicitCompact || contextAttr === 'hand' || contextAttr === 'board';

        const opts = {
            name: name,
            cost: cost,
            rarity: (['common', 'uncommon', 'rare', 'epic', 'legendary'].includes(rarityKey) ? (rarityKey as any) : 'common') as any,
            description: stats || '',
            stats: stats || '',
            image: image,
            type: (['attack', 'defense', 'buff', 'economy'].includes(typeKey) ? (typeKey as any) : 'attack') as any,
            compact: compact,
        };

        let svg = '';
        try {
            svg = createCardSVG(opts as any);
            // Ensure the returned SVG scales to container width by adding inline styles
            svg = svg.replace('<svg', '<svg style="width:100%;height:auto;display:block;"');
        } catch (err) {
            error('[match-card] createCardSVG failed', err, {opts});
            svg = `<div class="match-card-fallback"><div class="match-card-image"><img src="${this.escape(image)}" alt="${this.escape(name)}"/></div><div class="match-card-main"><div class="match-card-header"><span class="match-card-name">${this.escape(name)}</span><span class="match-card-cost">${this.escape(String(cost))}g</span></div></div></div>`;
        }

        const wrapperClass = this.getAttribute('class') ?? '';

        // Detect special marry refusal card and apply a red border when shown in hand (compact)
        const isRefusalCard = String(cardId ?? '') === 'marry_refusal';
        const refusalClass = isRefusalCard && compact ? ' refusal-card-draw' : '';

        // Merge badge overlay (positioned top-right of the card)
        // Smaller merge badge: we attach a dedicated `.merge-badge` class and
        // style it in CSS so we can tweak scale/padding centrally.
        const mergeBadgeHtml = stackCount > 0 ? `<div class="match-card-merge absolute bottom-2 right-2"><span class="merge-badge inline-flex items-center justify-center rounded-full bg-green-600 text-white text-[10px] px-1 opacity-75">+${stackCount * 100}%</span></div>` : '';

        // Not-enough overlay
        const notEnoughHtml = notEnough ? `<div class="match-card-not-enough absolute inset-0 flex items-center justify-center bg-black/40 text-white text-sm">Not enough</div>` : '';

        // Render without inline width; CSS will set the container width per context
        this.innerHTML = `
      <style>
        .match-card-tile { border: none; background: transparent; padding: 0; }
        .refusal-card-draw { box-shadow: 0 0 0 3px rgba(239,68,68,0.95) inset; border-radius: 8px; }
      </style>
      <button type="button" class="match-card-tile ${this.escape(wrapperClass)} relative overflow-visible${refusalClass}" ${passthroughAttrs.join(' ')}>
        <div class="match-card-svg-container">${svg}</div>
        ${mergeBadgeHtml}
        ${notEnoughHtml}
      </button>
    `;
    }
}

if (!customElements.get('match-card')) customElements.define('match-card', MatchCard);

export {};


/**
 * cards.ts
 *
 * Helpers for loading card metadata from the API and converting card payloads
 * into unit information used by the battle animation (type/hp heuristics).
 */

import type {CardType, CardRarity, MatchCard} from "../ui/types/card-types";

/**
 * Fetch card metadata from the provided API base URL. Returns normalized
 * MatchCard objects suitable for rendering and game logic.
 */
export async function fetchMatchCards(apiBase: string): Promise<MatchCard[]> {
    const res = await fetch(`${apiBase}/cards`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok || !Array.isArray(data.cards)) {
        throw new Error("Failed to load cards");
    }

    return data.cards.map((c: any): MatchCard => ({
        id: c.id,
        name: c.name,
        description: c.description ?? "",
        type: (typeof c.type === "string" ? c.type.toLowerCase() : "attack") as CardType,
        rarity: (c.rarity ?? "common") as CardRarity,
        image: c.image ?? "",
        cost: c.cost ?? 0,
        baseDamage: c.baseDamage ?? null,
        baseHpBonus: c.baseHpBonus ?? null,
        baseDpsBonus: c.baseDpsBonus ?? null,
        economyBonus: c.economyBonus ?? null,
        buffMultiplier: c.buffMultiplier ?? null,
        config: c.config ?? {},
    }));
}

const CARD_UNIT_OVERRIDES: Record<string, { type: string; hp: number }> = {
    'ogre_assault': {type: 'ogre', hp: 30},
    'goblin_raid': {type: 'goblin', hp: 10},
    'improved_ballista': {type: 'placeholder', hp: 12},
};

/**
 * Map a card id or card object into a simple { type, hp } unit description
 * used by the client-side battle simulator/renderer.
 */
export function cardToUnitInfo(cardOrId: MatchCard | string | null | undefined): { type: string; hp: number } {
    try {
        if (!cardOrId) return {type: 'goblin', hp: 10};
        let id: string;
        let name = '';
        let img = '';
        let typ = '';
        let baseHp = NaN;

        if (typeof cardOrId === 'string') {
            id = cardOrId;
            try {
                const getCard = (window as any).getCardById as ((id: string) => any) | undefined;
                const card = typeof getCard === 'function' ? getCard(id) : null;
                if (card) {
                    name = String(card.name ?? '');
                    img = String(card.image ?? '');
                    typ = String(card.type ?? '');
                    baseHp = Number(card.baseHpBonus ?? card.baseHp ?? NaN);
                }
            } catch {
            }
        } else {
            id = String((cardOrId as any).id ?? '');
            name = String((cardOrId as any).name ?? '');
            img = String((cardOrId as any).image ?? '');
            typ = String((cardOrId as any).type ?? '');
            baseHp = Number((cardOrId as any).baseHpBonus ?? (cardOrId as any).baseHp ?? NaN);
        }

        const key = id.toLowerCase();
        if (CARD_UNIT_OVERRIDES[key]) return {...CARD_UNIT_OVERRIDES[key]};

        // heuristic mapping
        const lname = name.toLowerCase();
        const limg = img.toLowerCase();

        if (key.includes('ogre') || lname.includes('ogre') || limg.includes('ogre')) return {
            type: 'ogre',
            hp: Math.max(20, Number.isFinite(baseHp) ? Math.floor(baseHp) : 25)
        };
        if (key.includes('goblin') || lname.includes('goblin') || limg.includes('goblin')) return {
            type: 'goblin',
            hp: Math.max(6, Number.isFinite(baseHp) ? Math.floor(baseHp) : 10)
        };
        if (key.includes('ballista') || lname.includes('ballista') || limg.includes('ballista') || key.includes('ball')) return {
            type: 'placeholder',
            hp: Math.max(8, Number.isFinite(baseHp) ? Math.floor(baseHp) : 12)
        };

        const t = String(typ ?? '').toLowerCase();
        if (t === 'attack' || t === 'creature' || t === 'unit') return {
            type: 'goblin',
            hp: Math.max(6, Number.isFinite(baseHp) ? Math.floor(baseHp) : 10)
        };

        return {type: 'goblin', hp: Math.max(6, Number.isFinite(baseHp) ? Math.floor(baseHp) : 10)};
    } catch (e) {
        return {type: 'goblin', hp: 10};
    }
}

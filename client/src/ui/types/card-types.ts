/**
 * card-types.ts
 *
 * Shared TypeScript types describing card shapes and match zones used across
 * the client UI. These are small, portable types consumed by card components
 * and match screens.
 */

/** A card's gameplay type which affects placement and behaviour. */
export type CardType = "attack" | "defense" | "buff" | "economy";

/** Rarity tier for visual tinting and gameplay rules. */
export type CardRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/**
 * Minimal runtime representation of a card used inside matches and UI.
 * Keep this shape compact to easily serialize/deserialize from the server.
 */
export type MatchCard = {
    /** unique card identifier */
    id: string;
    /** human readable name */
    name: string;
    /** textual description shown on the card */
    description: string;
    /** gameplay type */
    type: CardType;
    /** rarity tier */
    rarity: CardRarity;
    /** image URL (may be empty) */
    image: string;
    /** gold cost to play */
    cost: number;
    /** optional numeric stats */
    baseDamage: number | null;
    baseHpBonus: number | null;
    baseDpsBonus: number | null;
    economyBonus: number | null;
    buffMultiplier: number | null;
    /** arbitrary engine-specific config object (kept as any) */
    config: any;
};

/** A board slot which may hold a card and a stack count for merges. */
export type MatchCardSlot = {
    card: MatchCard | null;
    stackCount: number;
};

/** Logical zone kinds used by UI helpers. */
export type MatchZoneKind = "deck" | "hand" | "discard" | "attackBoard" | "defenseBoard";

/** Current zones present in the match UI. */
export type MatchZones = {
    deck: MatchCard[];
    hand: MatchCard[];
    discard: MatchCard[];
    board: MatchCardSlot[];
};

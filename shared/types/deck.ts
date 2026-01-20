/**
 * deck.ts
 *
 * Shared deck model types used by both client and server code.
 * - `SharedDeckCard` describes a card entry inside a deck with quantity and level
 * - `SharedDeck` represents a named collection of deck cards
 *
 * These are intentionally lightweight serializable shapes (no methods) so they
 * are safe to send over the wire and persist in simple JSON stores.
 */

export type SharedDeckCard = {
  id: string;
  name: string;
  // Card archetype (e.g. 'ATTACK', 'ECONOMY', ...). Nullable when unknown.
  type: string | null;
  // Card level (for upgrade semantics)
  level: number;
  // How many copies of this card are present in the deck
  copies: number;
};

export type SharedDeck = {
  // Stable deck identifier
  id: string;
  // Human-friendly deck name
  name: string;
  // The card entries that compose the deck
  cards: SharedDeckCard[];
};

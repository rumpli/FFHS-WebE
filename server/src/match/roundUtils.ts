/**
 * roundUtils.ts
 *
 * Helpers that perform transformations on player state between rounds/phases.
 * Currently includes `prepareShopTransition` which converts hand to deck and
 * discards buff/economy cards from board into discard pile when transitioning
 * to the shop phase.
 */

import type {MatchPlayerStateJson} from "../ws/matchState.js";

export function prepareShopTransition(state: MatchPlayerStateJson, cardTypeLookup: Map<string, string>, shuffleFn: (arr: string[]) => string[] = (a) => a): MatchPlayerStateJson {
    // Return hand to deck and clear hand
    if (Array.isArray(state.hand) && state.hand.length > 0) {
        state.deck = shuffleFn(state.deck.concat(state.hand));
        state.hand = [];
    }
    if (!Array.isArray(state.discard)) state.discard = [];
    // Cards that are BUFF or ECONOMY are single-use/highly contextual and should be
    // discarded from the board when moving to the shop phase
    for (let i = 0; i < state.board.length; i++) {
        const slot = state.board[i];
        if (slot.cardId) {
            const t = cardTypeLookup.get(slot.cardId);
            if (t === 'BUFF' || t === 'ECONOMY') {
                state.discard.push(slot.cardId);
                state.board[i] = {cardId: null, stackCount: 0};
            }
        }
    }
    return state;
}

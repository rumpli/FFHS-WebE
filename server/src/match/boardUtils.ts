/**
 * boardUtils.ts
 *
 * Small helpers that operate on a player's board array. Provides logic to
 * place a card from hand onto a board slot and perform automatic merging when
 * three or more identical cards are present (pick the highest-merge slot as
 * the merge target).
 */

import type {MatchPlayerStateJson} from "../ws/matchState.js";

export interface BoardMergeInfo {
    cardId: string;
    chosenIndex: number;
    clearedIndices: number[];
    newMergeCount: number;
}

/**
 * Place a card from `handIndex` onto `boardIndex` in the provided state. If
 * placing the card creates a 3-of-a-kind (or more) merge, the merge is
 * performed: one slot increases its `stackCount` and two other matching slots
 * are cleared.
 *
 * @returns BoardMergeInfo when a merge happened, otherwise null.
 */
export function placeCardAndMaybeMerge(s: MatchPlayerStateJson, handIndex: number, boardIndex: number, cardId: string): BoardMergeInfo | null {
    if (!Array.isArray(s.board)) s.board = Array.from({length: 7}).map(() => ({cardId: null, stackCount: 0} as any));
    if (!Array.isArray(s.hand)) s.hand = [];
    if (handIndex < 0 || handIndex >= s.hand.length) return null;
    if (boardIndex < 0 || boardIndex >= s.board.length) return null;

    const slot = s.board[boardIndex];

    // if target slot occupied, cannot place
    if (slot.cardId) return null;

    // perform placement
    slot.cardId = cardId;
    slot.stackCount = slot.stackCount ?? 0;

    // remove from hand
    s.hand.splice(handIndex, 1);

    // collect indices of same cardId on board
    const sameIndices: number[] = [];
    for (let i = 0; i < s.board.length; i++) {
        if (s.board[i].cardId === cardId) sameIndices.push(i);
    }

    // if we have 3 or more, perform merge behaviour
    if (sameIndices.length >= 3) {
        // choose the slot with the highest existing stackCount as the recipient
        let chosen = sameIndices[0];
        let maxMerge = -1;
        for (const idx of sameIndices) {
            const sc = s.board[idx].stackCount ?? 0;
            if (sc > maxMerge) {
                maxMerge = sc;
                chosen = idx;
            }
        }
        // If the newly placed card's slot is among them and has highest/equal
        // stack count prefer the newly placed slot as recipient.
        if (sameIndices.includes(boardIndex)) {
            const newlyMerge = s.board[boardIndex].stackCount ?? 0;
            if (newlyMerge >= maxMerge) chosen = boardIndex;
        }

        // increment chosen slot's stack count and clear two others
        s.board[chosen].stackCount = (s.board[chosen].stackCount ?? 0) + 1;
        const cleared: number[] = [];
        let clearedCount = 0;
        for (const idx of sameIndices) {
            if (idx === chosen) continue;
            s.board[idx] = {cardId: null, stackCount: 0} as any;
            cleared.push(idx);
            clearedCount++;
            if (clearedCount >= 2) break;
        }
        return {
            cardId,
            chosenIndex: chosen,
            clearedIndices: cleared,
            newMergeCount: s.board[chosen].stackCount ?? 0,
        };
    }
    return null;
}

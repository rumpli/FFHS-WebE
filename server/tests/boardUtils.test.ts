/**
 * boardUtils.test.ts
 *
 * Unit tests for the board utility `placeCardAndMaybeMerge`.
 * These exercises check card placement, merge behavior, and merge-count
 * propagation across repeated merges.
 */

import {describe, it, expect} from 'vitest';
import {placeCardAndMaybeMerge} from '../src/match/boardUtils.js';

function makeState() {
    return {
        hand: [],
        deck: [],
        discard: [],
        board: Array.from({length: 7}).map(() => ({cardId: null, stackCount: 0})),
    } as any;
}

describe('placeCardAndMaybeMerge', () => {
    it('places a card into empty slot', () => {
        const s = makeState();
        s.hand = ['c1'];
        placeCardAndMaybeMerge(s, 0, 2, 'c1');
        expect(s.board[2].cardId).toBe('c1');
        expect(s.hand.length).toBe(0);
    });

    it('merges three identical cards into one slot and frees two slots', () => {
        const s = makeState();
        s.hand = ['c1', 'c1', 'c1'];

        placeCardAndMaybeMerge(s, 0, 0, 'c1');
        placeCardAndMaybeMerge(s, 0, 1, 'c1');
        placeCardAndMaybeMerge(s, 0, 2, 'c1');

        const filled = s.board.map((b: any, i: number) => b.cardId ? i : -1).filter(i => i !== -1);

        const nonEmpty = s.board.filter((b: any) => b.cardId);
        expect(nonEmpty.length).toBe(1);
        const chosen = s.board.findIndex((b: any) => b.cardId === 'c1');

        expect(s.board[chosen].stackCount).toBe(1);
    });

    it('re-merges to increase mergeCount when three appear again', () => {
        const s = makeState();

        s.board[0] = {cardId: 'c1', stackCount: 1};
        s.board[1] = {cardId: null, stackCount: 0};
        s.board[2] = {cardId: null, stackCount: 0};
        s.hand = ['c1', 'c1'];


        placeCardAndMaybeMerge(s, 0, 1, 'c1');
        placeCardAndMaybeMerge(s, 0, 2, 'c1');

        const nonEmpty = s.board.filter((b: any) => b.cardId);
        expect(nonEmpty.length).toBe(1);
        const chosen = s.board.findIndex((b: any) => b.cardId === 'c1');
        expect(s.board[chosen].stackCount).toBe(2);
    });
});

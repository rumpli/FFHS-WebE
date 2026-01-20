/**
 * roundUtils.test.ts
 *
 * Unit tests for round utility helpers (e.g., shop transitions), ensuring
 * deterministic behavior for state transitions and slot computations.
 */

import {describe, it, expect} from 'vitest';
import {prepareShopTransition} from '../src/match/roundUtils.js';

describe('prepareShopTransition', () => {
    it('moves hand back into deck and shuffles via provided shuffler', () => {
        const state = {
            deck: ['a', 'b'],
            hand: ['h1', 'h2'],
            discard: [],
            board: Array.from({length: 7}).map(() => ({cardId: null, stackCount: 0})),
        } as any;

        const shuffler = (arr: string[]) => ['SHUFFLED', ...arr];
        const newState = prepareShopTransition(state, new Map(), shuffler);
        expect(newState.hand).toEqual([]);
        expect(newState.deck[0]).toBe('SHUFFLED');

        expect(newState.deck).toEqual(['SHUFFLED', 'a', 'b', 'h1', 'h2']);
    });

    it('discards BUFF and ECONOMY cards from board, leaves ATTACK/DEFENSE', () => {
        const state = {
            deck: [],
            hand: [],
            discard: [],
            board: [
                {cardId: 'c1', stackCount: 1},
                {cardId: 'c2', stackCount: 1},
                {cardId: 'c3', stackCount: 1},
                {cardId: null, stackCount: 0},
                {cardId: 'c4', stackCount: 2},
                {cardId: 'c2', stackCount: 1},
                {cardId: null, stackCount: 0},
            ],
        } as any;

        const types = new Map<string, string>([['c1', 'BUFF'], ['c2', 'ATTACK'], ['c3', 'ECONOMY'], ['c4', 'DEFENSE']]);
        const newState = prepareShopTransition(state, types, (a) => a);

        expect(newState.discard).toEqual(expect.arrayContaining(['c1', 'c3']));

        expect(newState.board[0].cardId).toBeNull();
        expect(newState.board[2].cardId).toBeNull();

        expect(newState.board[1].cardId).toBe('c2');
        expect(newState.board[4].cardId).toBe('c4');
    });
});

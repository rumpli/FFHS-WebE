/**
 * drawCards.test.ts
 *
 * Unit tests for drawing helpers in `matchState`: `drawCards` and
 * `drawMultipleCards` ensuring discard shuffling and draw limits are respected.
 */

import {describe, it, expect} from 'vitest';
import {drawCards, defaultPlayerState, MATCH_CONFIG, drawMultipleCards} from '../src/ws/matchState.js';

describe('drawCards', () => {
    it('shuffles discard into deck and draws up to max per call', () => {
        const s = defaultPlayerState();
        s.deck = [];
        s.discard = ['a', 'b', 'c', 'd'];
        s.hand = [];


        const out = drawCards(s, 5);

        expect(out.hand.length).toBeGreaterThan(0);
        expect(out.hand.length).toBeLessThanOrEqual(MATCH_CONFIG.maxDrawPerCall);

        expect(Array.isArray(out.deck)).toBe(true);
    });

    it('limits draws per call to maxDrawPerCall', () => {
        const s = defaultPlayerState();
        s.deck = ['c1', 'c2', 'c3', 'c4', 'c5'];
        s.hand = [];
        s.discard = [];


        const out = drawCards(s, 5);
        expect(out.hand.length).toBe(MATCH_CONFIG.maxDrawPerCall);
    });

    it('drawMultipleCards respects provided handSizeLimit', () => {
        const s = defaultPlayerState();
        s.deck = ['c1', 'c2', 'c3', 'c4', 'c5'];
        s.hand = ['h1', 'h2'];
        s.discard = [];


        const out = drawMultipleCards(s, 5, 3);
        expect(out.hand.length).toBeLessThanOrEqual(3);
    });
});

/**
 * effects.test.ts
 *
 * Unit tests for `applyCardEffect` which applies immediate and persistent
 * effects from BUFF and ECONOMY card types to a player state.
 */

import {describe, it, expect} from 'vitest';
import {applyCardEffect} from '../src/match/effects.js';

describe('applyCardEffect', () => {

    it('records pendingBuffs for BUFF cards', () => {
        const state: any = {gold: 0};
        const card = {id: 'b1', type: 'BUFF', buffMultiplier: 1.2, config: {target: 'next_attack'}} as any;
        const out = applyCardEffect(state, card) as any;
        expect(Array.isArray(out.pendingBuffs)).toBe(true);
        expect(out.pendingBuffs[0].cardId).toBe('b1');
        expect(out.pendingBuffs[0].multiplier).toBe(1.2);
    });

    it('schedules extra draws for next round when ECONOMY extra_draw_next_round is played', () => {
        const state: any = {gold: 0, pendingExtraDraws: 0};
        const card = {id: 'e1', type: 'ECONOMY', config: {kind: 'extra_draw_next_round', extraDraw: 2}} as any;
        const out = applyCardEffect(state, card) as any;
        expect(Number(out.pendingExtraDraws)).toBe(2);
    });

    it('adds persistent per-round gold when ECONOMY gold_per_round is played', () => {
        const state: any = {gold: 0, goldPerRound: 0};
        const card = {id: 'a1', type: 'ECONOMY', config: {kind: 'gold_per_round', goldPerRound: 2}} as any;
        const out = applyCardEffect(state, card) as any;
        expect(Number(out.goldPerRound)).toBe(2);
    });

    it('normalizes BUFF target all_attacks_next_round to units and records multiplier', () => {
        const state: any = {gold: 0};
        const card = {id: 'b2', type: 'BUFF', buffMultiplier: 1.5, config: {target: 'all_attacks_next_round'}} as any;
        const out = applyCardEffect(state, card) as any;
        expect(Array.isArray(out.pendingBuffs)).toBe(true);
        expect(out.pendingBuffs[0].multiplier).toBe(1.5);
        expect(out.pendingBuffs[0].target).toBe('units');
    });
});

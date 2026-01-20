/**
 * simulator.test.ts
 *
 * Unit tests for the battle simulator ensuring expected combat outcomes for
 * representative setups (goblins, ogres, defenses).
 */

import {describe, it, expect} from 'vitest';
import {simulateBattle, CardDef} from '../src/sim/simulator.js';


import {defaultPlayerState} from '../src/ws/matchState.js';

function copyState() {
    return JSON.parse(JSON.stringify(defaultPlayerState()));
}

describe('simulator basic', () => {
    it('tower kills goblins before they reach in baseline', () => {
        const a = copyState();
        const b = copyState();


        a.towerHp = 100;
        b.towerHp = 100;

        const gob = 'goblin';
        b.board[0].cardId = gob;
        b.board[0].stackCount = 2;

        const defs = new Map<string, CardDef>([[gob, {id: gob, baseDamage: 2, type: 'ATTACK', hp: 10}]]);

        const res = simulateBattle(a, b, defs, {ticksToReach: 3, maxTicks: 100});
        expect(res.bTowerHp).toBeGreaterThan(0);
        expect(res.winner).not.toBe('B');
    });

    it('ogre deals more damage and can kill tower', () => {
        const a = copyState();
        const b = copyState();
        a.towerHp = 30;

        a.towerDps = 5;
        b.towerHp = 100;

        const ogre = 'ogre';
        b.board[0].cardId = ogre;
        b.board[0].stackCount = 0;

        const defs = new Map<string, CardDef>([[ogre, {id: ogre, baseDamage: 10, type: 'ATTACK', hp: 25}]]);

        const res = simulateBattle(a, b, defs, {ticksToReach: 3, maxTicks: 100});

        expect(res.aTowerHp).toBeLessThan(30);
    });

    it('defense increases DPS and can kill multiple goblins', () => {
        const a = copyState();
        const b = copyState();
        a.towerHp = 100;
        b.towerHp = 100;

        const gob = 'goblin';
        b.board[0].cardId = gob;
        b.board[0].stackCount = 3;

        const ballista = 'ballista';
        a.board[0].cardId = ballista;
        a.board[0].stackCount = 1;

        const defs = new Map<string, CardDef>([
            [gob, {id: gob, baseDamage: 2, type: 'ATTACK', hp: 10}],
            [ballista, {id: ballista, baseDamage: 3, type: 'DEFENSE'}],
        ]);

        const res = simulateBattle(a, b, defs, {ticksToReach: 3, maxTicks: 100});

        expect(res.bUnitsRemaining.length).toBeLessThanOrEqual(1);
    });
});

/**
 * smoke-sim.ts
 *
 * Small simulator smoke test that constructs two board states (many goblins
 * vs a single ogre) and runs the battle simulation for a short duration.
 * Useful to validate core sim mechanics quickly during development.
 */

import {simulateBattle, CardDef} from '../src/sim/simulator.js';

function buildState(boardCards: { cardId: string; stackCount?: number }[], towerHp = 1000) {
    return {
        towerLevel: 1,
        towerHp,
        towerHpMax: towerHp,
        towerDps: 10,
        round: 1,
        gold: 0,
        rerollCost: 2,
        totalDamageOut: 0,
        totalDamageIn: 0,
        deck: [],
        hand: [],
        discard: [],
        board: Array.from({length: 7}).map((_, i) => boardCards[i] ?? {cardId: null, stackCount: 0}),
        shop: [],
        phase: 'shop',
        roundTimerTs: null,
        lastTowerUpgradeRound: 0,
    } as any;
}

async function run() {

    const defMap = new Map<string, CardDef>();
    defMap.set('goblin', {id: 'goblin', baseDamage: 1, type: 'ATTACK', hp: 10, approachTicks: 5, shots: 1, splash: 1});
    defMap.set('ogre', {id: 'ogre', baseDamage: 3, type: 'ATTACK', hp: 25, approachTicks: 10, shots: 1, splash: 1});

    const aBoard = [
        {cardId: 'goblin', stackCount: 2},
        {cardId: 'goblin', stackCount: 2},
        {cardId: 'goblin', stackCount: 2},
        {cardId: null, stackCount: 0},
        {cardId: null, stackCount: 0},
        {cardId: null, stackCount: 0},
        {cardId: null, stackCount: 0},
    ];

    const bBoard = [
        {cardId: 'ogre', stackCount: 0},
        {cardId: null, stackCount: 0},
        {cardId: null, stackCount: 0},
        {cardId: null, stackCount: 0},
        {cardId: null, stackCount: 0},
        {cardId: null, stackCount: 0},
        {cardId: null, stackCount: 0},
    ];

    const stateA = buildState(aBoard, 1000);
    const stateB = buildState(bBoard, 1000);

    console.log('Simulating battle: A has many goblins, B has an ogre');
    const result = simulateBattle(stateA, stateB, defMap, {ticksToReach: 10, maxTicks: 200});
    console.log('Result:', {
        winner: result.winner,
        ticks: result.ticks,
        aTowerHp: result.aTowerHp,
        bTowerHp: result.bTowerHp,
        eventsCount: result.events?.length ?? 0,
        sampleEvents: result.events?.slice(0, 12) ?? [],
    });
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});

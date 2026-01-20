/**
 * smoke-goblin-raid.ts
 *
 * Lightweight smoke test that runs the battle simulator with a single
 * `goblin_raid` card on one side and an empty board on the other. This
 * script is intended for quick local verification of the simulator logic.
 *
 * It constructs minimal CardDef entries, builds two match states and calls
 * `simulateBattle` from the simulator module, then prints a short summary
 * of the outcome and a sample of events for manual inspection.
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
        // board is a fixed-length array representing 7 slots (some may be null)
        board: Array.from({length: 7}).map((_, i) => boardCards[i] ?? {cardId: null, stackCount: 0}),
        shop: [],
        phase: 'shop',
        roundTimerTs: null,
        lastTowerUpgradeRound: 0,
    } as any;
}

async function run() {
    // Prepare a minimal card definition map used by the simulator
    const defMap = new Map<string, CardDef>();
    defMap.set('goblin_raid', {
        id: 'goblin_raid',
        baseDamage: 10,
        type: 'ATTACK',
        config: {enemies: 8, enemyType: 'goblin', damagePerEnemy: 2},
    });

    const aBoard = [{cardId: 'goblin_raid', stackCount: 0}, null, null, null, null, null, null];
    const bBoard = [null, null, null, null, null, null, null];

    const stateA = buildState(aBoard as any);
    const stateB = buildState(bBoard as any);

    console.log('Simulating goblin_raid vs empty');
    const result = simulateBattle(stateA, stateB, defMap, {ticksToReach: 10, maxTicks: 200});
    console.log(JSON.stringify({
        winner: result.winner,
        ticks: result.ticks,
        aTowerHp: result.aTowerHp,
        bTowerHp: result.bTowerHp,
        eventsCount: result.events?.length ?? 0,
        sampleEvents: result.events?.slice(0, 20)
    }, null, 2));
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});

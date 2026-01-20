/**
 * simulator.ts
 *
 * Deterministic (tick-based) battle simulator used to produce per-round
 * replays and to compute round outcomes. The simulator consumes two
 * `MatchPlayerStateJson` snapshots and a map of `CardDef` entries describing
 * unit behavior.
 *
 * The simulator model is intentionally simple: boards are converted to unit
 * lists, units approach over a configurable number of ticks, towers and
 * defensive shots (including splash) are applied each tick, and the battle
 * resolves when towers reach zero or both sides have no units remaining.
 */

import type {MatchPlayerStateJson} from "../ws/matchState.js";

export type CardDef = {
    id: string;
    baseDamage?: number | null;
    type?: string | null;
    hp?: number | null;
    baseHpBonus?: number | null;
    approachTicks?: number | null;
    shots?: number | null;
    splash?: number | null;
    config?: any;
};

export type Unit = {
    cardId: string;
    hp: number;
    maxHp: number;
    dmgPerTick: number;
    approach: number;
};

export type BattleResult = {
    winner: 'A' | 'B' | 'DRAW';
    ticks: number;
    aTowerHp: number;
    bTowerHp: number;
    aUnitsRemaining: Unit[];
    bUnitsRemaining: Unit[];
    events?: { from: 'A' | 'B'; to: 'A' | 'B'; amount: number; tick: number; target?: 'units' | 'tower' }[];
    initialAUnits?: Array<{
        id: string;
        cardId?: string | null;
        type: string;
        hp: number;
        maxHp: number;
        dmgPerTick?: number;
        approach: number
    }>;
    initialBUnits?: Array<{
        id: string;
        cardId?: string | null;
        type: string;
        hp: number;
        maxHp: number;
        dmgPerTick?: number;
        approach: number
    }>;
    shotsPerTick?: Array<{
        aShots: number;
        bShots: number;
        aShotsDetail?: Array<{ damage: number; splash: number; sourceCardId?: string | null }>;
        bShotsDetail?: Array<{ damage: number; splash: number; sourceCardId?: string | null }>
    }>;
    ticksToReach?: number;
    perTickSummary?: Array<{
        tick: number;
        aAlive: number;
        bAlive: number;
        aReached: number;
        bReached: number;
        aDead: number;
        bDead: number;
        aDmgToTower: number;
        bDmgToTower: number;
    }>;
};

/**
 * Default unit HP based on card ID and definition.
 */
function defaultUnitHpForCard(cardId: string, def?: CardDef) {
    if (def && typeof def.hp === 'number') return def.hp;
    const id = (cardId || '').toLowerCase();
    if (id.includes('goblin')) return 10;
    if (id.includes('ogre')) return 25;
    return 10;
}

/**
 * Default approach (ticks to reach) based on card ID, ticks to reach, and definition.
 */
function defaultApproachForCard(cardId: string, ticksToReach: number, def?: CardDef) {
    if (def && typeof def.approachTicks === 'number') return def.approachTicks;
    const id = (cardId || '').toLowerCase();
    // Goblins are faster: half the ticks
    if (id.includes('goblin')) return Math.max(1, Math.floor(ticksToReach / 2));
    if (id.includes('ogre')) return Math.max(1, ticksToReach);
    return ticksToReach;
}

/**
 * Build unit list from board slots and definition map.
 */
function buildUnitsFromBoard(board: Array<{
    cardId: string | null;
    stackCount?: number
}>, defMap: Map<string, CardDef>, ticksToReach: number): Unit[] {
    const units: Unit[] = [];
    for (const slot of board) {
        if (!slot.cardId) continue;
        const def = defMap.get(slot.cardId) as CardDef | undefined;
        const type = def?.type ?? 'ATTACK';
        if (type !== 'ATTACK') continue;
        const merge = slot.stackCount ?? 0;
        const baseEnemies = (def?.config && typeof def.config.enemies === 'number') ? Math.max(1, Math.floor(def.config.enemies)) : 1;
        const count = baseEnemies * (1 + merge);
        const baseDmg = (def?.config && typeof def.config.damagePerEnemy === 'number')
            ? def.config.damagePerEnemy
            : (def?.baseDamage ?? 1);
        let hp = defaultUnitHpForCard(slot.cardId, def);
        if (typeof def?.hp === 'number') hp = def.hp;
        if (typeof def?.baseHpBonus === 'number') hp = Math.max(1, hp + def.baseHpBonus);
        const approach = defaultApproachForCard(slot.cardId, ticksToReach, def);
        for (let i = 0; i < count; i++) {
            units.push({cardId: slot.cardId, hp, maxHp: hp, dmgPerTick: baseDmg, approach});
        }
    }
    return units;
}

/**
 * Compute the attack plan for a tower based on the current state and definition map.
 */
function computeTowerAttackPlan(state: MatchPlayerStateJson, defMap: Map<string, CardDef>) {
    const shots: Array<{ damage: number; splash: number; sourceCardId?: string | null }> = [];
    const baseDps = Math.max(0, Math.round(state.towerDps ?? 0));
    if (baseDps > 0) shots.push({damage: baseDps, splash: 1});
    for (const slot of state.board) {
        if (!slot.cardId) continue;
        const def = defMap.get(slot.cardId);
        if (!def) continue;
        if ((def.type ?? 'ATTACK') === 'DEFENSE') {
            const merge = slot.stackCount ?? 0;
            const perShot = Math.max(0, def.baseDamage ?? 0);
            const baseShots = Math.max(1, def.shots ?? 1);
            const shotsCount = baseShots * (1 + merge);
            const splash = Math.max(1, def.splash ?? 1);
            for (let i = 0; i < shotsCount; i++) {
                shots.push({damage: perShot, splash, sourceCardId: slot.cardId});
            }
        }
    }
    return shots;
}

/**
 * Apply a shot (damage and splash) to a list of units, returning the modified list.
 */
function applyShotToUnits(units: Unit[], damage: number, splash: number): Unit[] {
    if (damage <= 0) return units;
    if (splash <= 1) return applyDamageToUnits(units, damage);
    const copy = units.map((u) => ({...u}));
    for (let i = 0; i < splash; i++) {
        if (i >= copy.length) break;
        copy[i].hp -= damage;
    }
    return copy.filter((u) => u.hp > 0);
}

/**
 * Apply damage to a list of units, returning the modified list.
 */
function applyDamageToUnits(units: Unit[], damage: number): Unit[] {
    if (damage <= 0) return units;
    const remaining: Unit[] = [];
    let carry = damage;
    for (const u of units) {
        if (carry <= 0) {
            remaining.push(u);
            continue;
        }
        if (u.hp > carry) {
            const copy = {...u, hp: u.hp - carry};
            carry = 0;
            remaining.push(copy);
        } else {
            carry -= u.hp;
        }
    }
    return remaining;
}

/**
 * Calculate the total damage that a list of units will deal to a tower.
 */
function unitsDamageToTower(units: Unit[]): number {
    let dmg = 0;
    for (const u of units) {
        if (u.approach <= 0) dmg += u.dmgPerTick;
    }
    return dmg;
}

/**
 * Simulate a battle between two states, returning the result.
 */
export function simulateBattle(
    aState: MatchPlayerStateJson,
    bState: MatchPlayerStateJson,
    defMap: Map<string, CardDef>,
    opts?: { ticksToReach?: number; maxTicks?: number },
): BattleResult {
    const ticksToReach = opts?.ticksToReach ?? 20;
    const maxTicks = opts?.maxTicks ?? 1000;

    /**
     * Apply buffs from the pendingBuffs array in the state to the simulation.
     */
    const applyBuffsToState = (state: MatchPlayerStateJson) => {
        const buffs = (state as any).pendingBuffs as Array<any> | undefined;
        if (!Array.isArray(buffs) || !buffs.length) return;
        let unitMul = 1;
        let towerMul = 1;
        for (const b of buffs) {
            const m = Number(b?.multiplier) || 1;
            const t = String(b?.target ?? 'units');
            if (t === 'tower') towerMul *= m; else unitMul *= m;
        }
        (state as any)._simUnitMul = unitMul;
        (state as any)._simTowerMul = towerMul;
    };

    applyBuffsToState(aState);
    applyBuffsToState(bState);

    try {
        (aState as any).pendingBuffs = [];
    } catch (e) {
    }
    try {
        (bState as any).pendingBuffs = [];
    } catch (e) {
    }

    let aUnits = buildUnitsFromBoard(aState.board, defMap, ticksToReach);
    let bUnits = buildUnitsFromBoard(bState.board, defMap, ticksToReach);

    let aTower = aState.towerHp ?? 0;
    let bTower = bState.towerHp ?? 0;

    let tick = 0;
    const events: { from: 'A' | 'B'; to: 'A' | 'B'; amount: number; tick: number; target?: 'units' | 'tower' }[] = [];
    const shotsPerTick: Array<{
        aShots: number;
        bShots: number;
        aShotsDetail?: Array<{ damage: number; splash: number; sourceCardId?: string | null }>;
        bShotsDetail?: Array<{ damage: number; splash: number; sourceCardId?: string | null }>
    }> = [];
    const perTickSummary: Array<{
        tick: number;
        aAlive: number;
        bAlive: number;
        aReached: number;
        bReached: number;
        aDead: number;
        bDead: number;
        aDmgToTower: number;
        bDmgToTower: number
    }> = [];

    const aUnitMul = Number((aState as any)._simUnitMul ?? 1);
    const bUnitMul = Number((bState as any)._simUnitMul ?? 1);
    for (const u of aUnits) {
        u.hp = Math.max(1, Math.round((u.hp ?? 1) * aUnitMul));
        u.maxHp = Math.max(1, Math.round((u.maxHp ?? u.hp) * aUnitMul));
        u.dmgPerTick = Math.max(0, Math.round((u.dmgPerTick ?? 0) * aUnitMul));
    }
    for (const u of bUnits) {
        u.hp = Math.max(1, Math.round((u.hp ?? 1) * bUnitMul));
        u.maxHp = Math.max(1, Math.round((u.maxHp ?? u.hp) * bUnitMul));
        u.dmgPerTick = Math.max(0, Math.round((u.dmgPerTick ?? 0) * bUnitMul));
    }

    const initialAUnits = aUnits.map((u, i) => ({
        id: `A-${i}`,
        cardId: u.cardId,
        type: ((u.cardId || '').toLowerCase().includes('ogre') ? 'ogre' : 'goblin'),
        hp: u.hp,
        maxHp: u.maxHp,
        dmgPerTick: u.dmgPerTick,
        approach: u.approach
    }));
    const initialBUnits = bUnits.map((u, i) => ({
        id: `B-${i}`,
        cardId: u.cardId,
        type: ((u.cardId || '').toLowerCase().includes('ogre') ? 'ogre' : 'goblin'),
        hp: u.hp,
        maxHp: u.maxHp,
        dmgPerTick: u.dmgPerTick,
        approach: u.approach
    }));

    for (; tick < maxTicks; tick++) {
        let aShots = computeTowerAttackPlan(aState, defMap);
        let bShots = computeTowerAttackPlan(bState, defMap);
        const aTowerMul = Number((aState as any)._simTowerMul ?? 1);
        const bTowerMul = Number((bState as any)._simTowerMul ?? 1);
        if (aTowerMul !== 1) aShots = aShots.map(s => ({
            damage: Math.max(0, Math.round(s.damage * aTowerMul)),
            splash: s.splash
        }));
        if (bTowerMul !== 1) bShots = bShots.map(s => ({
            damage: Math.max(0, Math.round(s.damage * bTowerMul)),
            splash: s.splash
        }));
        shotsPerTick.push({
            aShots: aShots.length,
            bShots: bShots.length,
            aShotsDetail: aShots.map(s => ({
                damage: s.damage,
                splash: s.splash,
                sourceCardId: (s as any).sourceCardId ?? null
            })),
            bShotsDetail: bShots.map(s => ({
                damage: s.damage,
                splash: s.splash,
                sourceCardId: (s as any).sourceCardId ?? null
            })),
        });

        bUnits = bUnits.sort((x, y) => x.approach - y.approach);
        const preBCount = bUnits.length;
        for (const s of aShots) {
            const preHp = bUnits.reduce((s, u) => s + u.hp, 0);
            bUnits = applyShotToUnits(bUnits, s.damage, s.splash);
            const postHp = bUnits.reduce((s, u) => s + u.hp, 0);
            const applied = Math.max(0, preHp - postHp);
            if (applied > 0) events.push({from: 'A', to: 'B', amount: applied, tick, target: 'units'});
        }

        aUnits = aUnits.sort((x, y) => x.approach - y.approach);
        const preACount = aUnits.length;
        for (const s of bShots) {
            const preHp = aUnits.reduce((s, u) => s + u.hp, 0);
            aUnits = applyShotToUnits(aUnits, s.damage, s.splash);
            const postHp = aUnits.reduce((s, u) => s + u.hp, 0);
            const applied = Math.max(0, preHp - postHp);
            if (applied > 0) events.push({from: 'B', to: 'A', amount: applied, tick, target: 'units'});
        }
        const postBCount = bUnits.length;
        const postACount = aUnits.length;
        const bDeadThisTick = Math.max(0, preBCount - postBCount);
        const aDeadThisTick = Math.max(0, preACount - postACount);

        for (const u of aUnits) u.approach -= 1;
        for (const u of bUnits) u.approach -= 1;

        const aUnitsAt = aUnits.filter((u) => u.approach <= 0);
        const bUnitsAt = bUnits.filter((u) => u.approach <= 0);

        const dmgToBTower = unitsDamageToTower(aUnitsAt);
        const dmgToATower = unitsDamageToTower(bUnitsAt);
        if (dmgToBTower > 0) events.push({from: 'A', to: 'B', amount: dmgToBTower, tick, target: 'tower'});
        if (dmgToATower > 0) events.push({from: 'B', to: 'A', amount: dmgToATower, tick, target: 'tower'});
        bTower -= dmgToBTower;
        aTower -= dmgToATower;

        perTickSummary.push({
            tick,
            aAlive: aUnits.length,
            bAlive: bUnits.length,
            aReached: aUnitsAt.length,
            bReached: bUnitsAt.length,
            aDead: aDeadThisTick,
            bDead: bDeadThisTick,
            aDmgToTower: dmgToATower,
            bDmgToTower: dmgToBTower,
        });

        if (aTower <= 0 && bTower <= 0) {
            return {
                winner: 'DRAW',
                ticks: tick + 1,
                aTowerHp: Math.max(0, aTower),
                bTowerHp: Math.max(0, bTower),
                aUnitsRemaining: aUnits,
                bUnitsRemaining: bUnits,
                events,
                initialAUnits,
                initialBUnits,
                shotsPerTick,
                ticksToReach,
                perTickSummary
            };
        }
        if (aTower <= 0) {
            return {
                winner: 'B',
                ticks: tick + 1,
                aTowerHp: Math.max(0, aTower),
                bTowerHp: Math.max(0, bTower),
                aUnitsRemaining: aUnits,
                bUnitsRemaining: bUnits,
                events,
                initialAUnits,
                initialBUnits,
                shotsPerTick,
                ticksToReach,
                perTickSummary
            };
        }
        if (bTower <= 0) {
            return {
                winner: 'A',
                ticks: tick + 1,
                aTowerHp: Math.max(0, aTower),
                bTowerHp: Math.max(0, bTower),
                aUnitsRemaining: aUnits,
                bUnitsRemaining: bUnits,
                events,
                initialAUnits,
                initialBUnits,
                shotsPerTick,
                ticksToReach,
                perTickSummary
            };
        }

        const aActive = aUnits.length > 0;
        const bActive = bUnits.length > 0;
        if (!aActive && !bActive) {
            return {
                winner: 'DRAW',
                ticks: tick + 1,
                aTowerHp: Math.max(0, aTower),
                bTowerHp: Math.max(0, bTower),
                aUnitsRemaining: aUnits,
                bUnitsRemaining: bUnits,
                events,
                initialAUnits,
                initialBUnits,
                shotsPerTick,
                ticksToReach,
                perTickSummary
            };
        }
    }
    return {
        winner: 'DRAW',
        ticks: maxTicks,
        aTowerHp: Math.max(0, aTower),
        bTowerHp: Math.max(0, bTower),
        aUnitsRemaining: aUnits,
        bUnitsRemaining: bUnits,
        events,
        initialAUnits,
        initialBUnits,
        shotsPerTick,
        ticksToReach,
        perTickSummary
    };
}

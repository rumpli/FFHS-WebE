/**
 * battle-anim-core.ts
 *
 * Core simulation event applier used by the battle animation renderer.
 * Contains logic to map events (unit damage, tower damage, per-tick summaries)
 * onto local UnitState maps and produce visual popups and tower flash timings.
 */

import type {UnitState, Popup} from "./battle-anim-utils";
import {debug} from "../core/log";

/**
 * Determine which sim lane (0=a, 1=b, -1=unknown) should be treated as the
 * local player's lane for display purposes. The function first attempts to
 * match provided userIds, then inspects seeded unit lists for ownerUserIds.
 *
 * @param aUserId - owner id for lane A
 * @param bUserId - owner id for lane B
 * @param localUserId - id of the local user (may be empty)
 * @param initialUnits - optional seeded units to inspect for ownerUserId fields
 * @returns 0 if local corresponds to lane A, 1 for lane B, -1 when unknown
 */
export function recomputeLocalSimLane(aUserId: string, bUserId: string, localUserId: string, initialUnits?: any): 0 | 1 | -1 {
    const local = String(localUserId ?? "");
    if (!local) return -1;
    if (aUserId && local === aUserId) return 0;
    if (bUserId && local === bUserId) return 1;

    try {
        const a = Array.isArray(initialUnits?.aUnits) ? initialUnits!.aUnits : [];
        const b = Array.isArray(initialUnits?.bUnits) ? initialUnits!.bUnits : [];
        const aHas = a.some((u: any) => String(u?.ownerUserId ?? "") === local);
        const bHas = b.some((u: any) => String(u?.ownerUserId ?? "") === local);
        if (aHas && !bHas) return 0;
        if (bHas && !aHas) return 1;
        return -1;
    } catch {
        return -1;
    }
}

/**
 * Apply a set of events that occur on a single simulation tick to the provided
 * UnitState maps and update popups/tower flash timing.
 *
 * This function mutates:
 *  - unitsBySimLane (Map of lane -> Map of UnitState)
 *  - popups (pushes Popup objects)
 *  - towerFlashUntilByDisplay (updates flash time for tower display lanes)
 *
 * The function is resilient to partially missing data and prefers caller
 * provided laneByUser mapping when inferring user lanes.
 */
export function applyTickEvents(
    evs: any[],
    unitsBySimLane: Map<0 | 1, Map<string, UnitState>>,
    perTickSummary: any[] | undefined,
    popups: Popup[],
    towerFlashUntilByDisplay: Map<0 | 1, number>,
    now: number,
    localUserId: string,
    currentTick?: number,
    localSimLane?: 0 | 1 | -1,
    ownUserId?: string,
    oppUserId?: string,
    laneByUser?: Map<string, 0 | 1>
) {
    if (!Array.isArray(evs) || !unitsBySimLane) return;

    const simLaneForUnitOwner = (userId: string) => {
        const id = String(userId ?? "");
        if (!id) return (localUserId ? 1 : 0) as 0 | 1;
        // First, if caller provided laneByUser mapping, prefer it
        if (laneByUser && laneByUser.has(id)) return laneByUser.get(id)!;
        // Next, attempt to find an explicit ownerUserId on seeded units
        for (const lane of [0, 1] as (0 | 1)[]) {
            const laneMap = unitsBySimLane.get(lane)!;
            for (const u of laneMap.values()) {
                if (String((u as any).ownerUserId ?? "") === id) return lane;
            }
        }
        // If we were given ownUserId/oppUserId, prefer those mappings. If localSimLane is known use it.
        if (ownUserId && id === ownUserId) {
            if (typeof localSimLane === 'number' && (localSimLane === 0 || localSimLane === 1)) return localSimLane;
            // if localSimLane unknown, attempt to find lane that contains ownUserId
            for (const lane of [0, 1] as (0 | 1)[]) {
                const laneMap = unitsBySimLane.get(lane)!;
                for (const u of laneMap.values()) if (String((u as any).ownerUserId ?? "") === ownUserId) return lane;
            }
        }
        if (oppUserId && id === oppUserId) {
            if (typeof localSimLane === 'number' && (localSimLane === 0 || localSimLane === 1)) return (1 - localSimLane) as 0 | 1;
            for (const lane of [0, 1] as (0 | 1)[]) {
                const laneMap = unitsBySimLane.get(lane)!;
                for (const u of laneMap.values()) if (String((u as any).ownerUserId ?? "") === oppUserId) return lane;
            }
        }
        // Fallback: if the id matches localUserId, assume local is display/bottom (sim lane 1)
        if (localUserId && id === localUserId) {
            if (typeof localSimLane === 'number' && (localSimLane === 0 || localSimLane === 1)) return localSimLane;
            return 1 as 0 | 1;
        }
        // final fallback: assume lane 0
        return 0 as 0 | 1;
    };

    // UNIT damage events
    for (const ev of evs) {
        if (String(ev?.target ?? "units") !== "units") continue;

        const toId = String(ev?.toUserId ?? "");
        const simLane = simLaneForUnitOwner(toId);

        const laneMap = unitsBySimLane.get(simLane)!;
        const alive = Array.from(laneMap.values())
            .filter((u) => u.alive)
            .sort((a, b) => a.approachMax - b.approachMax || a.id.localeCompare(b.id));

        try {
            debug('[battle-anim-core] unit damage ev', {toId, simLane, aliveIds: alive.map((u) => u.id), ev});
        } catch {
        }

        let remaining = Math.max(0, Number(ev.amount ?? 0) || 0);
        for (const u of alive) {
            if (remaining <= 0) break;
            const take = Math.min(u.hp, remaining);
            u.hp = Math.max(0, u.hp - take);
            remaining -= take;
            if (u.hp <= 0) {
                u.alive = false;
                u.deathStartTs = now;
                u.deathLifeMs = 800;
            }
        }
    }

    // perTickSummary override (optional) - format: [{ tick, entries: [{ userId, alive, reached, dead, dmgToTower }, ...] }, ...]
    try {
        if (Array.isArray(perTickSummary)) {
            // determine current tick: prefer provided currentTick, else fall back to scheduler-enriched ev._tickIndex on first event
            const tickToUse = typeof currentTick === 'number' ? Number(currentTick) : ((Array.isArray(evs) && evs.length && typeof evs[0]._tickIndex === 'number') ? Number(evs[0]._tickIndex) : 0);
            const s = perTickSummary.find((p: any) => Number(p?.tick ?? -1) === tickToUse) ?? null;
            if (s && Array.isArray(s.entries)) {
                // Build a map from userId -> desired alive count
                const aliveMap = new Map<string, number>();
                for (const ent of s.entries) {
                    const uid = String(ent?.userId ?? "");
                    if (!uid) continue;
                    aliveMap.set(uid, Number(ent.alive ?? 0));
                }

                // Apply alive overrides per sim lane by mapping userId -> sim lane
                // Prefer the laneByUser mapping provided by the caller (anim), else infer from seeded units
                const laneByUserMap = laneByUser ?? new Map<string, 0 | 1>();
                if (!laneByUser) {
                    for (const lane of [0, 1] as (0 | 1)[]) {
                        const laneMap = unitsBySimLane.get(lane)!;
                        for (const u of laneMap.values()) {
                            if (u && (u as any).ownerUserId) laneByUserMap.set(String((u as any).ownerUserId), lane);
                        }
                    }
                }

                // Apply desired alive counts to each lane where we can determine the owner
                for (const [uid, desiredAlive] of aliveMap.entries()) {
                    const lane = laneByUserMap.get(uid);
                    if (typeof lane === 'number') {
                        const laneMap = unitsBySimLane.get(lane)!;
                        const alive = Array.from(laneMap.values())
                            .filter((u) => u.alive)
                            .sort((a, b) => a.approachMax - b.approachMax || a.id.localeCompare(b.id));
                        const toKill = Math.max(0, alive.length - Math.max(0, Math.floor(desiredAlive)));
                        for (let i = 0; i < toKill; i++) {
                            const u = alive[i];
                            if (!u) continue;
                            u.hp = 0;
                            u.alive = false;
                            u.deathStartTs = now;
                            u.deathLifeMs = 800;
                        }
                    }
                }
                // ALSO: create tower popups from perTickSummary dmgToTower fields (preferred over individual tower events)
                try {
                    for (const ent of s.entries) {
                        const uid = String(ent?.userId ?? "");
                        const dmg = Math.max(0, Math.floor(Number(ent?.dmgToTower ?? 0) || 0));
                        if (!dmg) continue;
                        // Prefer explicit own/opp mapping for display lane when available.
                        let displayLane: 0 | 1 = 1;
                        if (uid && ownUserId && uid === String(ownUserId)) {
                            displayLane = 1; // own user's tower -> bottom
                        } else if (uid && oppUserId && uid === String(oppUserId)) {
                            displayLane = 0; // opponent's tower -> top
                        } else {
                            // map userId -> sim lane (prefer provided laneByUser)
                            const simLane = laneByUserMap.get(uid) ?? (() => {
                                // try to find owner in seeded units
                                for (const lane of [0, 1] as (0 | 1)[]) {
                                    const map = unitsBySimLane.get(lane)!;
                                    for (const u of map.values()) if (String((u as any).ownerUserId ?? "") === uid) return lane;
                                }
                                return 0 as 0 | 1;
                            })();
                            // determine display lane: if simLane equals localSimLane -> display top (0), else bottom (1)
                            if (typeof localSimLane === 'number' && (localSimLane === 0 || localSimLane === 1)) {
                                displayLane = simLane === localSimLane ? 0 : 1;
                            } else {
                                displayLane = localUserId && uid === localUserId ? 1 : 0;
                            }
                        }
                        // Push popups split into hits similar to tower-event handling
                        const hits = Math.max(1, Math.min(3, Number(ent?.hits ?? 0) || 1));
                        const base = Math.floor(dmg / hits);
                        let rem = dmg - base * hits;
                        const liveCount = popups.filter((p) => p.displayLane === displayLane && now >= p.bornAt && now < p.bornAt + p.lifeMs).length;
                        for (let i = 0; i < hits; i++) {
                            const part = base + (rem > 0 ? 1 : 0);
                            if (rem > 0) rem--;
                            if (part <= 0) continue;
                            const staggerIdx = liveCount + i;
                            const bornAt = now + staggerIdx * 140;
                            const color = displayLane === 1 ? "#059669" : "#ef4444";
                            popups.push({text: `-${part}`, bornAt, lifeMs: 900, color, displayLane, staggerIdx});
                            const until = bornAt + 200;
                            const prev = towerFlashUntilByDisplay.get(displayLane) ?? 0;
                            if (until > prev) towerFlashUntilByDisplay.set(displayLane, until);
                        }
                    }
                } catch (e) {
                }
            }
        }
    } catch {
    }
    // Build a set of userIds that have already had tower damage handled via perTickSummary
    const perTickHandledTower = ((): Set<string> => {
        const s = new Set<string>();
        try {
            if (Array.isArray(perTickSummary)) {
                const tickToUse = typeof currentTick === 'number' ? Number(currentTick) : ((Array.isArray(evs) && evs.length && typeof evs[0]._tickIndex === 'number') ? Number(evs[0]._tickIndex) : 0);
                const entry = perTickSummary.find((p: any) => Number(p?.tick ?? -1) === tickToUse) ?? null;
                if (entry && Array.isArray(entry.entries)) {
                    for (const ent of entry.entries) {
                        const uid = String(ent?.userId ?? "");
                        const dmg = Math.max(0, Number(ent?.dmgToTower ?? 0) || 0);
                        if (dmg > 0 && uid) s.add(uid);
                    }
                }
            }
        } catch {
        }
        return s;
    })();

    // TOWER damage: create popups + flash
    for (const ev of evs) {
        if (String(ev?.target ?? "units") !== "tower") continue;
        const toId = String(ev?.toUserId ?? "");
        // Prefer direct mapping if provided
        let displayLane: 0 | 1 = 1;
        if (oppUserId && toId === String(oppUserId)) {
            displayLane = 0; // opponent tower -> top
        } else if (ownUserId && toId === String(ownUserId)) {
            displayLane = 1; // own tower -> bottom
        } else {
            const toSimLane = simLaneForUnitOwner(toId);
            if (typeof localSimLane === 'number' && (localSimLane === 0 || localSimLane === 1)) {
                const oppSimLane = localSimLane === 0 ? 1 : 0;
                displayLane = toSimLane === oppSimLane ? 0 : 1;
            } else {
                displayLane = localUserId && toId === localUserId ? 1 : 0;
            }
        }
        // debug
        try {
            debug('[battle-anim-core] tower event', {toId, ownUserId, oppUserId, localSimLane, displayLane});
        } catch {
        }

        const total = Math.max(0, Math.floor(Number(ev.amount ?? 0) || 0));
        if (!total) continue;

        // Skip tower events that are already handled by perTickSummary
        if (perTickHandledTower.has(toId)) continue;

        const color = displayLane === 1 ? "#059669" : "#ef4444";
        const hits = Math.max(1, Math.min(3, Number(ev._hits ?? 0) || 1));
        const base = Math.floor(total / hits);
        let rem = total - base * hits;

        const liveCount = popups.filter((p) => p.displayLane === displayLane && now >= p.bornAt && now < p.bornAt + p.lifeMs).length;
        for (let i = 0; i < hits; i++) {
            const part = base + (rem > 0 ? 1 : 0);
            if (rem > 0) rem--;
            if (part <= 0) continue;
            const staggerIdx = liveCount + i;
            const bornAt = now + staggerIdx * 140;
            popups.push({text: `-${part}`, bornAt, lifeMs: 900, color, displayLane, staggerIdx});
            const until = bornAt + 200;
            const prev = towerFlashUntilByDisplay.get(displayLane) ?? 0;
            if (until > prev) towerFlashUntilByDisplay.set(displayLane, until);
        }
    }
}

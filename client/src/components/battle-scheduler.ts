/**
 * battle-scheduler.ts
 *
 * Helper to build and schedule a `battle-anim` overlay from server-supplied
 * events and optional simulation hints. Responsible for frame generation,
 * projectiles, event enrichment and DOM overlay lifecycle (safety/timeouts).
 */

import {state} from "../core/store";
import {debug, error} from "../core/log";
import {bus} from "../core/EventBus";
import type {BattleFrame} from "./battle-anim-utils";
import {enrichEventsWithTickIndex} from "./battle-anim-utils";
import {cardToUnitInfo} from "../core/cards";

/**
 * Infer owners for canonical a/b simulation lanes from a flat initialUnits array.
 * Returns { aOwnerId, bOwnerId } where missing values may be empty strings.
 */
export function inferSimABOwners(initialUnits: any): { aOwnerId: string; bOwnerId: string } {
    const flat = Array.isArray(initialUnits) ? initialUnits : [];
    const counts = new Map<string, number>();
    for (const u of flat) {
        const id = String(u?.ownerUserId ?? "");
        if (!id) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const aOwnerId = entries[0] ? entries[0][0] : "";
    const bOwnerId = entries[1] ? entries[1][0] : (entries[0] ? entries[0][0] : "");
    return {aOwnerId, bOwnerId};
}

/**
 * Build and display an overlay containing a `battle-anim` element. This is the
 * high-level entry point used by the UI when a match round finishes.
 */
export function scheduleBattleAnimations(
    ctx: any | null,
    matchId: string,
    round: number,
    events: any[],
    simTicksToReach?: number,
    simInitialUnits?: any,
    simShotsPerTick?: any[],
    simPerTickSummary?: any[]
) {
    // Allow empty events: we still want to show VS prelude + default lanes
    // so normalize to an array. Caller may pass undefined/null when there is
    // no battle (e.g., tie or no units); we still display a VS and empty lanes.
    events = Array.isArray(events) ? events : [];

    const key = `${matchId}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
    const timers: number[] = [];
    const container = document.body;

    const SIM_TICK_MS = 100; // canonical sim tick size

    try {
        debug("[battle-scheduler] scheduleBattleAnimations start", {matchId, round, events: events.length});

        const maxOffset = Math.max(...events.map((e) => Number(e.atMsOffset ?? 0)), 0);
        const extraPadMs = 600;
        const ticksFromOffsets = Math.max(6, Math.ceil((maxOffset + extraPadMs) / SIM_TICK_MS));
        const ticksToReach = Number(simTicksToReach) > 0 ? Math.max(6, Number(simTicksToReach)) : ticksFromOffsets;

        const frames: BattleFrame[] = [];
        const m = state.matchState as any;

        const flatUnits = Array.isArray(simInitialUnits)
            ? simInitialUnits
            : (Array.isArray(simInitialUnits?.aUnits) || Array.isArray(simInitialUnits?.bUnits))
                ? [...(Array.isArray(simInitialUnits?.aUnits) ? simInitialUnits.aUnits : []), ...(Array.isArray(simInitialUnits?.bUnits) ? simInitialUnits.bUnits : [])]
                : [];

        const playersSummary = (m?.playersSummary as any[]) || [];
        const aOwnerId = String(playersSummary[0]?.userId ?? "");
        const bOwnerId = String(playersSummary[1]?.userId ?? aOwnerId);

        // Split flat units into canonical a/b arrays
        const initA = flatUnits.filter((u: any) => String(u?.ownerUserId ?? "") === aOwnerId);
        const initB = flatUnits.filter((u: any) => String(u?.ownerUserId ?? "") === bOwnerId);

        const makeUnits = (src: any[], tick: number) =>
            src.map((u: any) => {
                // If unit carries cardId or minimal info, try to derive type/hp using cardToUnitInfo
                let type = u.type || 'goblin';
                let hp = typeof u.hp === 'number' ? u.hp : undefined;
                let maxHp = typeof u.maxHp === 'number' ? u.maxHp : undefined;
                try {
                    // If cardId present, use cardToUnitInfo
                    const cardRef = u.cardId ?? u.card ?? (u?.config?.cardId ?? null);
                    if ((!type) && cardRef) {
                        const info = cardToUnitInfo(cardRef as any);
                        type = info.type || type;
                        if (!Number.isFinite(hp as any)) hp = info.hp;
                        if (!Number.isFinite(maxHp as any)) maxHp = info.hp;
                    }
                } catch {
                }
                return {
                    id: u.id,
                    type: type || 'goblin',
                    approach: Math.max(0, (Number(u.approach) || ticksToReach) - tick),
                    hp: typeof hp === 'number' ? hp : undefined,
                    maxHp: typeof maxHp === 'number' ? maxHp : undefined,
                    ownerUserId: String(u?.ownerUserId ?? ""),
                };
            });

        // If there is truly nothing to animate (no units, no events and perTickSummary shows no activity),
        // build a single static frame so the overlay can finish quickly.
        const simSummaryHasActivity = Array.isArray(simPerTickSummary) && simPerTickSummary.some((p: any) => Array.isArray(p.entries) && p.entries.some((e: any) => Number(e?.alive ?? 0) > 0 || Number(e?.dmgToTower ?? 0) > 0 || Number(e?.dead ?? 0) > 0 || Number(e?.reached ?? 0) > 0));
        const emptyRun = (!initA.length && !initB.length && (!Array.isArray(events) || events.length === 0) && !simSummaryHasActivity);
        if (emptyRun) {
            frames.push({tick: 0, ticksToReach: 0, aUnits: [], bUnits: [], projectiles: []});
        } else {
            for (let tick = 0; tick <= ticksToReach; tick++) {
                frames.push({
                    tick,
                    ticksToReach,
                    aUnits: makeUnits(initA, tick),
                    bUnits: makeUnits(initB, tick),
                    projectiles: [],
                });
            }
        }

        // deterministic projectiles from shotsPerTick
        if (Array.isArray(simShotsPerTick) && simShotsPerTick.length) {
            const laneWidth = 700;
            const yTop = 36;
            const yBottom = 84;
            for (let t = 0; t < frames.length; t++) {
                const sp = simShotsPerTick[t] ?? {aShots: 0, bShots: 0};
                const aN = Math.max(0, Number(sp.aShots) || 0);
                for (let i = 0; i < aN; i++) {
                    const frac = (i + 1) / (aN + 1);
                    frames[t].projectiles.push({x: Math.floor(frac * laneWidth + 40), y: yTop});
                }
                const bN = Math.max(0, Number(sp.bShots) || 0);
                for (let i = 0; i < bN; i++) {
                    const frac = (i + 1) / (bN + 1);
                    frames[t].projectiles.push({x: Math.floor(frac * laneWidth + 40), y: yBottom});
                }
            }
        }

        // enrich events with tick index
        const enrichedEvents = enrichEventsWithTickIndex(events, ticksToReach, SIM_TICK_MS);

        debug("[battle-scheduler] frames generated", {matchId, ticksToReach, frameCount: frames.length});

        const animEl = document.createElement("battle-anim") as any;
        animEl.setAttribute("data-anim-key", key);
        animEl.setAttribute("match-id", String(matchId));
        animEl.setAttribute("round", String(round));
        animEl.setAttribute("tick-ms", "300");

        const players = (m?.playersSummary as any[]) || [];
        const me = players.find((p) => p.userId === state.userId) || null;
        const opp = players.find((p) => p.userId !== state.userId) || null;

        const myName = me?.username ?? "You";
        const oppName = opp?.username ?? "Opponent";

        const myColor = (me?.towerColor ?? m?.towerColor) === "red" ? "red" : "blue";
        const oppColor = opp?.towerColor === "red" ? "red" : "blue";

        const myLevel = Number(me?.towerLevel ?? m?.towerLevel ?? 1) || 1;
        const oppLevel = Number(opp?.towerLevel ?? 1) || 1;

        animEl.setAttribute("top-name", String(oppName));
        animEl.setAttribute("top-color", String(oppColor));
        animEl.setAttribute("top-level", String(oppLevel));

        animEl.setAttribute("bottom-name", String(myName));
        animEl.setAttribute("bottom-color", String(myColor));
        animEl.setAttribute("bottom-level", String(myLevel));

        const stateUserId2 = String(state.userId ?? "");
        const other = players.find((p) => p.userId !== stateUserId2) || null;
        const ownOwnerId = stateUserId2;
        const oppOwnerId = other?.userId ?? "";
        animEl.setAttribute("own-user-id", String(ownOwnerId));
        animEl.setAttribute("opp-user-id", String(oppOwnerId));
        animEl.setAttribute("local-user-id", String(stateUserId2));

        let localSimLane = -1;
        if (aOwnerId && bOwnerId && stateUserId2) {
            localSimLane = stateUserId2 === aOwnerId ? 0 : 1;
        }
        if (localSimLane === 0 || localSimLane === 1) animEl.setAttribute("local-sim-lane", String(localSimLane));

        try {
            animEl.initialUnits = simInitialUnits;
            animEl.perTickSummary = Array.isArray(simPerTickSummary) ? simPerTickSummary : undefined;
            animEl.shotsPerTick = Array.isArray(simShotsPerTick) ? simShotsPerTick : undefined;
        } catch {
        }

        const overlay = document.createElement("div");
        overlay.className = "fixed inset-0 overlay-blur";
        overlay.style.zIndex = String(2147483646);
        overlay.style.background = "rgba(255,255,255,0.02)";
        overlay.style.backdropFilter = "blur(4px)";
        overlay.style.setProperty("-webkit-backdrop-filter", "blur(4px)");
        overlay.setAttribute("data-anim-owned", "true");
        overlay.setAttribute("data-battle-overlay", "true");
        overlay.setAttribute("data-match-id", String(matchId));
        overlay.setAttribute("data-round", String(round));
        overlay.setAttribute("data-anim-key", key);

        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";

        const stage = document.createElement("div");
        stage.style.position = "relative";
        stage.style.width = "min(900px, 96vw)";
        stage.style.height = "min(520px, 92vh)";
        stage.style.display = "block";
        overlay.appendChild(stage);

        let vsWrapEl: HTMLElement | null = null;
        let vsStartTs: number | null = null;

        const hasUnits = Array.isArray(initA) || Array.isArray(initB) ? ((initA.length || initB.length) > 0) : false;
        const hasSimPerTickActivity = Array.isArray(simPerTickSummary) && simPerTickSummary.some((p: any) => Array.isArray(p.entries) && p.entries.some((e: any) => (Number(e?.alive ?? 0) > 0) || (Number(e?.dmgToTower ?? 0) > 0) || (Number(e?.dead ?? 0) > 0) || (Number(e?.reached ?? 0) > 0)));

        if (ctx == null) {
            const vsWrap = document.createElement("div");
            vsWrap.style.position = "absolute";
            vsWrap.style.inset = "0";
            vsWrap.style.display = "flex";
            vsWrap.style.alignItems = "center";
            vsWrap.style.justifyContent = "center";

            vsWrap.innerHTML = `
<div class="relative ml-[10vw] mr-[10vw] w-full max-w-3xl h-48 flex items-center justify-center" style="max-width:768px;margin:0 auto;">
  <div class="absolute left-0 inset-y-0 flex items-center">
    <div class="vs-bar vs-bar-left ${myColor === "red" ? "bg-red-600" : "bg-blue-600"}">
      <div class="vs-player-name">${myName}</div>
    </div>
  </div>
  <div class="absolute right-0 inset-y-0 flex items-center">
    <div class="vs-bar vs-bar-right ${oppColor === "red" ? "bg-red-600" : "bg-blue-600"}">
      <div class="vs-player-name">${oppName}</div>
    </div>
  </div>
  <div class="vs-center"><span class="vs-text">VS</span></div>
</div>`;

            stage.appendChild(vsWrap);
            vsWrapEl = vsWrap;
            vsStartTs = Date.now();
        }

        animEl.style.position = "absolute";
        animEl.style.inset = "0";
        animEl.style.display = "flex";
        animEl.style.alignItems = "center";
        animEl.style.justifyContent = "center";
        animEl.style.pointerEvents = "none";

        animEl.style.width = "min(800px, 90vw)";
        animEl.style.margin = "0 auto";
        animEl.style.background = "transparent";

        animEl.style.visibility = "hidden";
        animEl.style.opacity = "0";
        animEl.style.transition = "opacity 160ms linear";

        stage.appendChild(animEl);
        container.appendChild(overlay);
        debug("[battle-scheduler] overlay appended to DOM", {matchId, key});

        try {
            bus.emit('match:battle-started', {matchId: String(matchId), round: Number(round), key});
        } catch (e) {
        }

        const startAnimNow = () => {
            try {
                if (vsWrapEl) vsWrapEl.remove();
            } catch {
            }
            try {
                animEl.style.visibility = "visible";
                animEl.style.opacity = "1";
            } catch {
            }
            animEl.frames = frames;
            animEl.events = enrichedEvents;
            debug("[battle-scheduler] animEl.frames/events set", {
                matchId,
                frames: frames.length,
                events: enrichedEvents.length
            });
        };

        if (ctx == null) {
            const VS_PRELUDE_MS = 2000;
            const elapsed = Date.now() - (vsStartTs ?? Date.now());
            const remaining = Math.max(0, VS_PRELUDE_MS - elapsed);
            const t = window.setTimeout(startAnimNow, remaining) as unknown as number;
            timers.push(t);
        } else {
            startAnimNow();
        }

        let overlayRemoved = false;
        const removeOverlay = (reason: "finished" | "safety") => {
            if (overlayRemoved) return;
            overlayRemoved = true;
            try {
                overlay.remove();
            } catch {
            }

            try {
                bus.emit('match:battle-finished', {matchId: String(matchId), round: Number(round), key, reason});
            } catch (e) {
            }
        };

        const onAnimFinished = () => {
            try {
                for (const id of timers) window.clearTimeout(id);
            } catch {
            }
            try {
                animEl.removeEventListener("animation:finished", onAnimFinished as any);
            } catch {
            }
            removeOverlay("finished");
            try {
                if (ctx && ctx.animationTimers) ctx.animationTimers.delete(key);
            } catch {
            }
        };

        animEl.addEventListener("animation:finished", onAnimFinished as any);

        const tickMsAttr = Number(animEl.getAttribute("tick-ms") ?? 300);

        const postDelayAttr = (!enrichedEvents.length && !hasUnits && !hasSimPerTickActivity) ? 600 : Number(animEl.getAttribute("post-delay-ms") ?? 750);
        try {
            animEl.setAttribute("post-delay-ms", String(postDelayAttr));
        } catch {
        }

        let safetyMs: number;
        if (!enrichedEvents.length && !hasUnits && !hasSimPerTickActivity) {
            const VS_PRELUDE_MS = 2000;
            safetyMs = VS_PRELUDE_MS + postDelayAttr + 800;
        } else {
            safetyMs = (Number(ticksToReach ?? 6) + 4) * Math.max(40, tickMsAttr) + (postDelayAttr || 800) + 1200;
        }

        const safety = window.setTimeout(() => {
            removeOverlay("safety");
            try {
                if (ctx && ctx.animationTimers) ctx.animationTimers.delete(key);
            } catch {
            }
        }, safetyMs);

        timers.push(safety);
        try {
            if (ctx && ctx.animationTimers) ctx.animationTimers.set(key, timers);
        } catch {
        }
    } catch (e) {
        error("[battle-scheduler] scheduleBattleAnimations failed", e);
    }
}

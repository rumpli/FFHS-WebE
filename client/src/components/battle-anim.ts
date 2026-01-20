/**
 * battle-anim.ts
 *
 * High-level custom element that runs and renders a full battle animation.
 * Responsible for orchestrating frames, applying tick events (via core helper),
 * seeding unit states and driving the canvas renderer.
 */

import {send as wsSend} from "../core/ws";
import type {BattleFrame, UnitState, Popup} from "./battle-anim-utils";
import {normTowerColor, buildTowerSprite, createImage, hashId, seedUnitStates} from "./battle-anim-utils";
import {applyTickEvents as coreApplyTickEvents} from "./battle-anim-core";
import {renderLane} from "./battle-anim-renderer";
import {debug} from "../core/log";

/**
 * `battle-anim` custom element
 * - Public control methods: `play()`, `pause()`, `setSpeed()`
 * - Expects frames/events and optional sim hints to be assigned by consumer
 */
customElements.define(
    "battle-anim",
    class extends HTMLElement {
        private canvases: HTMLCanvasElement[] = [];
        private ctxs: CanvasRenderingContext2D[] = [];

        private timeline: BattleFrame[] = [];
        private tick = 0;

        private tickMs = 300;
        private baseTickMs = 300;
        private lastTickTs = 0;

        private tickSteps = 3;
        private stepHoldFrac = 0.22;
        private _paused = false;

        private localUserId = "";
        private ownUserId = "";
        private oppUserId = "";

        // display lanes: 0 = top, 1 = bottom
        private localSimLane: 0 | 1 | -1 = -1;

        // sprites
        private topTowerImg: HTMLImageElement | null = null;
        private bottomTowerImg: HTMLImageElement | null = null;
        private unitImgs: Map<string, HTMLImageElement> = new Map();

        // labels/colors
        private topName: string | null = null;
        private bottomName: string | null = null;
        private topColorAttr: string | null = null;
        private bottomColorAttr: string | null = null;
        private topLevel = 1;
        private bottomLevel = 1;

        // finish/ack
        private doneTimer: number | null = null;
        private finished = false;
        private postDelayMs = 1500;
        private animKey: string | null = null;
        private matchId: string | null = null;
        private round: number | null = null;

        // events
        private battleEvents: any[] = [];
        private eventsByTick = new Map<number, any[]>();
        private lastProcessedTick = -1;
        private lastActiveTick = 0;

        // sim hints (set by scheduler) - preferred format: flat UnitInfo[] with ownerUserId
        public initialUnits?: any[];
        public perTickSummary?: Array<any>;

        // external control: allow wrappers to set speed and pause/play
        public play() {
            try {
                this._paused = false;
                this.lastTickTs = performance.now();
            } catch {
            }
        }

        public pause() {
            try {
                this._paused = true;
            } catch {
            }
        }

        public setSpeed(speed: number | string) {
            try {
                let s = Number(speed as any);
                if (!Number.isFinite(s) || s <= 0) {
                    if (typeof speed === 'string' && speed.endsWith('x')) s = Number(speed.slice(0, -1));
                }
                if (!Number.isFinite(s) || s <= 0) return;
                this.baseTickMs = Math.max(20, Math.floor(this.baseTickMs || 300));
                this.tickMs = Math.max(20, Math.floor(this.baseTickMs / s));
            } catch {
            }
        }

        // state keyed by SIM lane (0/1)
        private unitsBySimLane: Map<0 | 1, Map<string, UnitState>> = new Map([
            [0, new Map()],
            [1, new Map()],
        ]);
        // map userId -> sim lane (filled after seeding initial units)
        private laneByUser: Map<string, 0 | 1> = new Map();

        // tower flash keyed by DISPLAY lane (0/1)
        private towerFlashUntilByDisplay: Map<0 | 1, number> = new Map();

        // popups keyed by DISPLAY lane (0/1)
        private popups: Popup[] = [];

        static get observedAttributes() {
            return [
                "own-user-id",
                "opp-user-id",
                "local-user-id",
                "top-name",
                "bottom-name",
                "top-color",
                "bottom-color",
                "top-level",
                "bottom-level",
                "tick-ms",
                "tick-steps",
                "step-hold-frac",
                "post-delay-ms",
                "data-anim-key",
                "anim-key",
                "match-id",
                "round",
                "local-sim-lane",
            ];
        }

        attributeChangedCallback() {
            this.readAttrs();
            this.recomputeMapping();

            try {
                this.topTowerImg = createImage(buildTowerSprite(normTowerColor(this.topColorAttr), this.topLevel));
                this.bottomTowerImg = createImage(buildTowerSprite(normTowerColor(this.bottomColorAttr), this.bottomLevel));
            } catch {
            }
        }

        private readAttrs() {
            this.ownUserId = String(this.getAttribute("own-user-id") ?? "");
            this.oppUserId = String(this.getAttribute("opp-user-id") ?? "");
            this.localUserId = String(this.getAttribute("local-user-id") ?? "");

            this.topName = this.getAttribute("top-name");
            this.bottomName = this.getAttribute("bottom-name");
            this.topColorAttr = this.getAttribute("top-color");
            this.bottomColorAttr = this.getAttribute("bottom-color");

            this.topLevel = Number(this.getAttribute("top-level") ?? 1) || 1;
            this.bottomLevel = Number(this.getAttribute("bottom-level") ?? 1) || 1;

            const ms = Number(this.getAttribute("tick-ms") ?? "");
            if (Number.isFinite(ms) && ms > 0) this.tickMs = Math.max(20, Math.floor(ms));
            // keep baseTickMs aligned if tick-ms was set explicitly
            if (!this.baseTickMs) this.baseTickMs = this.tickMs;

            const steps = Number(this.getAttribute("tick-steps") ?? "");
            if (Number.isFinite(steps) && steps >= 1) this.tickSteps = Math.max(1, Math.floor(steps));

            const hf = Number(this.getAttribute("step-hold-frac") ?? "");
            if (Number.isFinite(hf) && hf >= 0 && hf <= 0.9) this.stepHoldFrac = hf;

            const pd = Number(this.getAttribute("post-delay-ms") ?? "");
            if (Number.isFinite(pd) && pd > 0) this.postDelayMs = pd;

            this.animKey = this.getAttribute("data-anim-key") ?? this.getAttribute("anim-key");
            this.matchId = this.getAttribute("match-id");
            this.round = this.getAttribute("round") ? Number(this.getAttribute("round")) : null;
        }

        private recomputeMapping() {

            const attr = this.getAttribute("local-sim-lane");
            if (attr != null) {
                const n = Number(attr);
                if (Number.isFinite(n) && (n === 0 || n === 1)) {
                    this.localSimLane = n as 0 | 1;
                    return;
                }
            }

            try {
                for (const lane of [0, 1] as (0 | 1)[]) {
                    const map = this.unitsBySimLane.get(lane)!;
                    for (const u of map.values()) {
                        if (String((u as any).ownerUserId ?? "") === String(this.localUserId ?? "")) {
                            this.localSimLane = lane;
                            return;
                        }
                    }
                }
            } catch {
                // ignore and leave localSimLane as -1
            }
        }

        // Display lane -> sim lane
        // For mapping B: display 0 (top) = local user's sim lane; display 1 (bottom) = other lane.
        private simLaneForDisplay(displayLane: 0 | 1): 0 | 1 {
            if (this.localSimLane === 0 || this.localSimLane === 1) {
                return displayLane === 0 ? this.localSimLane : ((1 - this.localSimLane) as 0 | 1);
            }
            // Fallback: assume canonical bottom=sim1
            return displayLane === 1 ? 1 : 0;
        }

        connectedCallback() {
            this.readAttrs();
            this.recomputeMapping();

            this.innerHTML = `
        <canvas data-lane="top"></canvas>
        <canvas data-lane="bottom"></canvas>
      `;

            this.style.display = "flex";
            this.style.flexDirection = "column";
            this.style.gap = "8px";
            this.style.alignItems = "stretch";

            this.canvases = Array.from(this.querySelectorAll("canvas"));
            this.ctxs = this.canvases.map((c) => c.getContext("2d")!);

            for (const c of this.canvases) {
                c.width = 800;
                c.height = 120;
                (c.style as any).width = "100%";
                (c.style as any).height = "120px";
            }

            this.topTowerImg = createImage(buildTowerSprite(normTowerColor(this.topColorAttr), this.topLevel));
            this.bottomTowerImg = createImage(buildTowerSprite(normTowerColor(this.bottomColorAttr), this.bottomLevel));

            this.ensureUnitImage("goblin", "/assets/goblinraid.png");
            this.ensureUnitImage("ogre", "/assets/ogreassault.png");
            this.ensureUnitImage("placeholder", "/assets/placeholder.png");

            this.lastTickTs = performance.now();
            requestAnimationFrame(this.loop);
        }

        private ensureUnitImage(type: string, src: string) {
            if (this.unitImgs.has(type)) return;
            try {
                const img = createImage(src);
                this.unitImgs.set(type, img);
            } catch {
            }
        }

        set events(e: any[]) {
            this.battleEvents = Array.isArray(e) ? e.slice() : [];
            this.eventsByTick.clear();
            this.popups = [];
            this.towerFlashUntilByDisplay.clear();

            for (const ev of this.battleEvents) {
                const tickIndex = typeof ev._tickIndex === "number" ? Math.max(0, Math.floor(ev._tickIndex)) : 0;
                const list = this.eventsByTick.get(tickIndex) ?? [];
                list.push(ev);
                this.eventsByTick.set(tickIndex, list);
                this.lastActiveTick = Math.max(this.lastActiveTick, tickIndex);
            }
        }

        set frames(f: BattleFrame[]) {
            this.timeline = Array.isArray(f) ? f : [];
            this.tick = 0;
            this.lastTickTs = performance.now();

            this.recomputeMapping();

            this.unitsBySimLane.set(0, new Map());
            this.unitsBySimLane.set(1, new Map());

            const first = this.timeline[0] ?? null;

            let aInit: any[] = [];
            let bInit: any[] = [];

            const firstAOwner = first?.aUnits && first.aUnits.length ? String(first.aUnits[0]?.ownerUserId ?? "") : "";
            const firstBOwner = first?.bUnits && first.bUnits.length ? String(first.bUnits[0]?.ownerUserId ?? "") : "";

            const flat = Array.isArray(this.initialUnits) ? (this.initialUnits as any[]) : [];
            if (firstAOwner || firstBOwner) {
                // Use owners found in first frame to split flat initial units if available
                if (flat.length) {
                    aInit = flat.filter((u) => String(u?.ownerUserId ?? "") === firstAOwner);
                    bInit = flat.filter((u) => String(u?.ownerUserId ?? "") === firstBOwner);
                }
                // Fallback to frame-provided arrays if flat was empty
                if (!aInit.length) aInit = Array.isArray(first?.aUnits) ? first!.aUnits : [];
                if (!bInit.length) bInit = Array.isArray(first?.bUnits) ? first!.bUnits : [];
            } else if (flat.length) {
                // No owner info in frames: fall back to splitting flat by provided own/opp attrs (scheduler set these)
                const ownId = String(this.ownUserId ?? "");
                const oppId = String(this.oppUserId ?? "");
                if (ownId || oppId) {
                    aInit = flat.filter((u) => String(u?.ownerUserId ?? "") === ownId);
                    bInit = flat.filter((u) => String(u?.ownerUserId ?? "") === oppId);
                }
                // If still empty, split by frequency
                if (!aInit.length && !bInit.length) {
                    const counts = new Map<string, any[]>();
                    for (const u of flat) {
                        const id = String(u?.ownerUserId ?? "");
                        if (!counts.has(id)) counts.set(id, []);
                        counts.get(id)!.push(u);
                    }
                    const entries = Array.from(counts.entries()).sort((x, y) => y[1].length - x[1].length);
                    aInit = entries[0] ? entries[0][1] : [];
                    bInit = entries[1] ? entries[1][1] : (entries[0] ? entries[0][1] : []);
                }
            } else {
                aInit = Array.isArray(first?.aUnits) ? first!.aUnits : [];
                bInit = Array.isArray(first?.bUnits) ? first!.bUnits : [];
            }

            // Seed unit state maps from initialUnits or first frame using canonical sim lanes (aUnits->lane0, bUnits->lane1)
            try {
                const m0 = this.unitsBySimLane.get(0)!;
                const m1 = this.unitsBySimLane.get(1)!;
                m0.clear();
                m1.clear();
                // Prefer aInit/bInit which were derived earlier (fallbacks included)
                seedUnitStates(m0, aInit, first?.ticksToReach ?? 10);
                seedUnitStates(m1, bInit, first?.ticksToReach ?? 10);
            } catch {
                // fallback: naive seeding
                for (const u of aInit) {
                    const id = String(u.id);
                    this.unitsBySimLane.get(0)!.set(id, {
                        id,
                        type: String(u.type ?? "goblin"),
                        hp: typeof u.hp === 'number' ? u.hp : 10,
                        maxHp: typeof u.maxHp === 'number' ? u.maxHp : (typeof u.hp === 'number' ? u.hp : 10),
                        ownerUserId: String((u as any).ownerUserId ?? ""),
                        alive: (typeof u.hp === 'number' ? u.hp : 10) > 0,
                        approachMax: Math.max(1, Number(u.approach) || first?.ticksToReach || 10),
                    });
                }
                for (const u of bInit) {
                    const id = String(u.id);
                    this.unitsBySimLane.get(1)!.set(id, {
                        id,
                        type: String(u.type ?? "goblin"),
                        hp: typeof u.hp === 'number' ? u.hp : 10,
                        maxHp: typeof u.maxHp === 'number' ? u.maxHp : (typeof u.hp === 'number' ? u.hp : 10),
                        ownerUserId: String((u as any).ownerUserId ?? ""),
                        alive: (typeof u.hp === 'number' ? u.hp : 10) > 0,
                        approachMax: Math.max(1, Number(u.approach) || first?.ticksToReach || 10),
                    });
                }
            }

            // fill laneByUser map from seeded units
            this.laneByUser.clear();
            try {
                for (const [lane, map] of this.unitsBySimLane) {
                    for (const u of map.values()) {
                        const id = String((u as any).ownerUserId ?? "");
                        if (id) this.laneByUser.set(id, lane);
                    }
                }
            } catch {
            }
            // Debug: log lane mapping
            try {
                const mapObj: any = {};
                for (const [k, v] of this.laneByUser) mapObj[k] = v;
                debug('[battle-anim] laneByUser', {
                    matchId: this.matchId,
                    round: this.round,
                    localUserId: this.localUserId,
                    ownUserId: this.ownUserId,
                    oppUserId: this.oppUserId,
                    localSimLane: this.localSimLane,
                    laneByUser: mapObj
                });
            } catch {
            }

            // After building laneByUser, if we can determine the localSimLane from it, do so (overrides earlier heuristics)
            try {
                const localId = String(this.localUserId ?? "") || String(this.ownUserId ?? "");
                if (localId && this.laneByUser.has(localId)) {
                    this.localSimLane = this.laneByUser.get(localId)!;
                    try {
                        this.setAttribute("local-sim-lane", String(this.localSimLane));
                    } catch {
                    }
                }
            } catch {
            }

            try {
                const mapObj: any = {};
                for (const [k, v] of this.laneByUser) mapObj[k] = v;
                debug('[battle-anim] laneByUser', {
                    matchId: this.matchId,
                    round: this.round,
                    localUserId: this.localUserId,
                    ownUserId: this.ownUserId,
                    oppUserId: this.oppUserId,
                    localSimLane: this.localSimLane,
                    laneByUser: mapObj
                });
            } catch {
            }

            this.lastActiveTick = Math.max(this.lastActiveTick, this.timeline.length - 1);
            if (Array.isArray(this.perTickSummary) && this.perTickSummary.length) {
                try {
                    const maxTick = this.perTickSummary.reduce((acc: number, p: any) => {
                        const t = Number(p?.tick ?? -1);
                        return Number.isFinite(t) ? Math.max(acc, t) : acc;
                    }, -1);
                    if (maxTick >= 0) this.lastActiveTick = Math.max(this.lastActiveTick, maxTick);
                } catch (e) {
                    this.lastActiveTick = Math.max(this.lastActiveTick, this.perTickSummary.length - 1);
                }
            }

            if (!Number.isFinite(this.lastActiveTick as any)) {
                this.lastActiveTick = Math.max(0, this.timeline.length - 1);
            }
            this.lastActiveTick = Math.max(0, Math.min(this.lastActiveTick, Math.max(0, this.timeline.length - 1)));

            if (this.doneTimer) {
                window.clearTimeout(this.doneTimer);
                this.doneTimer = null;
            }
            this.finished = false;
            this.lastProcessedTick = -1;
        }

        private loop = (now: number) => {
            if (!this.timeline.length) return requestAnimationFrame(this.loop);

            if (this._paused) {
                const frame = this.timeline[this.tick];
                const next = this.timeline[Math.min(this.tick + 1, this.timeline.length - 1)];
                this.drawLane(0, frame, next, 0, now);
                this.drawLane(1, frame, next, 0, now);
                return requestAnimationFrame(this.loop);
            }

            const steps = Math.max(1, Math.floor(this.tickSteps || 1));
            const stepMs = this.tickMs / steps;

            while (now - this.lastTickTs >= this.tickMs && this.tick < this.timeline.length - 1) {
                this.tick++;
                this.lastTickTs += this.tickMs;
            }

            const tickElapsed = Math.max(0, now - this.lastTickTs);
            const stepIndex = Math.min(steps - 1, Math.floor(tickElapsed / stepMs));
            const stepElapsed = tickElapsed - stepIndex * stepMs;

            const holdFrac = Math.max(0, Math.min(0.9, this.stepHoldFrac));
            const holdMs = stepMs * holdFrac;
            const inHold = stepElapsed < holdMs;
            const jumpAlphaIndex = inHold ? stepIndex : Math.min(stepIndex + 1, steps);

            let alpha = jumpAlphaIndex / steps;
            alpha = Math.max(0, Math.min(1, alpha));

            const frame = this.timeline[this.tick];
            const next = this.timeline[Math.min(this.tick + 1, this.timeline.length - 1)];

            if (this.tick !== this.lastProcessedTick) {
                this.applyTickEvents(now);
                this.lastProcessedTick = this.tick;
            }

            this.drawLane(0, frame, next, alpha, now);
            this.drawLane(1, frame, next, alpha, now);

            if (!this.finished && this.tick >= this.lastActiveTick) {
                if (!this.doneTimer) {
                    this.doneTimer = window.setTimeout(() => this.finish(), this.postDelayMs || 1200);
                }
            }

            requestAnimationFrame(this.loop);
        };

        private applyTickEvents(now: number) {
            const evs = this.eventsByTick.get(this.tick) ?? [];
            coreApplyTickEvents(evs, this.unitsBySimLane, this.perTickSummary, this.popups, this.towerFlashUntilByDisplay, now, this.localUserId, this.tick, this.localSimLane, this.ownUserId, this.oppUserId, this.laneByUser);
        }

        private drawLane(displayLane: 0 | 1, frame: BattleFrame, next: BattleFrame, alpha: number, now: number) {
            const ctx = this.ctxs[displayLane];
            const simLane = this.simLaneForDisplay(displayLane);
            renderLane({
                ctx,
                displayLane,
                simLane,
                frame,
                next,
                alpha,
                now,
                unitImgs: this.unitImgs,
                unitsBySimLane: this.unitsBySimLane,
                hashId,
                topColorAttr: this.topColorAttr,
                bottomColorAttr: this.bottomColorAttr,
                topName: this.topName,
                bottomName: this.bottomName,
                topTowerImg: this.topTowerImg,
                bottomTowerImg: this.bottomTowerImg,
                towerFlashUntilByDisplay: this.towerFlashUntilByDisplay,
                popups: this.popups,
            });
        }

        private finish() {
            if (this.finished) return;
            this.finished = true;

            if (this.doneTimer) {
                window.clearTimeout(this.doneTimer);
                this.doneTimer = null;
            }

            try {
                if (this.matchId && this.round != null) wsSend("BATTLE_DONE", {
                    matchId: this.matchId,
                    round: this.round
                });
            } catch {
            }

            try {
                this.dispatchEvent(
                    new CustomEvent("animation:finished", {
                        detail: {key: this.animKey, matchId: this.matchId, round: this.round},
                        bubbles: true,
                    })
                );
            } catch {
            }

            try {
                const noRemove = this.getAttribute("data-no-remove") === "true";
                if (noRemove) {
                    return;
                }
                const overlay = this.parentElement as HTMLElement | null;
                if (overlay && overlay.getAttribute("data-anim-owned") === "true") {
                    overlay.style.transition = "opacity 600ms ease";
                    overlay.style.opacity = "0";
                    setTimeout(() => {
                        try {
                            overlay.remove();
                        } catch {
                        }
                    }, 650);
                } else {
                    (this as HTMLElement).style.transition = "opacity 600ms ease";
                    (this as HTMLElement).style.opacity = "0";
                    setTimeout(() => {
                        try {
                            (this as HTMLElement).remove();
                        } catch {
                        }
                    }, 650);
                }
            } catch {
            }
        }
    }
);

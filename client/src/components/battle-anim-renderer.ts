/**
 * battle-anim-renderer.ts
 *
 * Rendering helpers for the battle animation canvas. Exposes `renderLane` which
 * draws a single display lane (top or bottom) given current/next frames, unit
 * sprites and state.
 */

import type {BattleFrame, UnitFrame, UnitState, Popup} from "./battle-anim-utils";
import {normTowerColor, drawTower, drawUnit, drawPopup} from "./battle-anim-utils";

export type RenderLaneOptions = {
    ctx: CanvasRenderingContext2D;
    displayLane: 0 | 1;
    simLane: 0 | 1;
    frame: BattleFrame;
    next: BattleFrame;
    alpha: number;
    now: number;
    unitImgs: Map<string, HTMLImageElement>;
    unitsBySimLane: Map<0 | 1, Map<string, UnitState>>;
    hashId: (id: string) => number;
    topColorAttr?: string | null;
    bottomColorAttr?: string | null;
    topName?: string | null;
    bottomName?: string | null;
    topTowerImg?: HTMLImageElement | null;
    bottomTowerImg?: HTMLImageElement | null;
    towerFlashUntilByDisplay: Map<0 | 1, number>;
    popups: Popup[];
};

/**
 * Draw a single display lane (top or bottom) into the provided canvas context.
 * The function mutates `unitsBySimLane` (adding seeded states) and updates the
 * `popups` array by consuming/rewriting entries that belong to the current
 * display lane.
 *
 * @param opts - render options and dependencies (images, state maps, timing)
 */
export function renderLane(opts: RenderLaneOptions) {
    const {
        ctx,
        displayLane,
        frame,
        next,
        alpha,
        now,
        unitImgs,
        unitsBySimLane,
        hashId,
        topColorAttr,
        bottomColorAttr,
        topName,
        bottomName,
        topTowerImg,
        bottomTowerImg,
        towerFlashUntilByDisplay,
        popups
    } = opts;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    const laneColor = normTowerColor(displayLane === 0 ? topColorAttr : bottomColorAttr);
    ctx.fillStyle = laneColor === "red" ? "#fee2e2" : "#dbeafe";
    ctx.fillRect(0, 0, w, h);

    const title = displayLane === 0 ? (topName ?? "") : (bottomName ?? "");
    ctx.save();
    ctx.font = "14px ui-sans-serif, system-ui, Arial";
    ctx.fillStyle = "#374151";
    ctx.textAlign = "center";
    ctx.fillText(title, w / 2, 18);
    ctx.restore();

    const towerX = displayLane === 0 ? w - 52 : 20;
    const towerY = h / 2 - 16;
    const towerW = 32;
    const towerH = 32;
    const towerImg = displayLane === 0 ? topTowerImg : bottomTowerImg;
    const flashUntil = towerFlashUntilByDisplay.get(displayLane) ?? 0;
    const flashAlpha = flashUntil && now < flashUntil ? Math.max(0, Math.min(1, (flashUntil - now) / 200)) : 0;
    drawTower(ctx, towerImg ?? null, towerX, towerY, towerW, towerH, flashAlpha);
    const simLane = opts.simLane;
    const u0 = simLane === 0 ? frame.aUnits : frame.bUnits;
    const u1 = simLane === 0 ? next.aUnits : next.bUnits;

    const map0 = new Map<string, UnitFrame>();
    for (const u of u0) map0.set(String(u.id), u);
    const map1 = new Map<string, UnitFrame>();
    for (const u of u1) map1.set(String(u.id), u);

    const laneState = unitsBySimLane.get(simLane)!;
    for (const u of u0) {
        const id = String(u.id);
        if (!laneState.has(id)) {
            const type = String(u.type ?? "goblin");
            const hp = typeof u.hp === "number" ? u.hp : (type === "ogre" ? 25 : 10);
            const maxHp = typeof u.maxHp === "number" ? u.maxHp : hp;
            const ap = Number(u.approach);
            const apMax = Number.isFinite(ap) && ap > 0 ? ap : frame.ticksToReach;
            laneState.set(id, {
                id,
                type,
                hp,
                maxHp,
                alive: hp > 0,
                approachMax: Math.max(1, apMax),
                ownerUserId: String((u as any).ownerUserId ?? "")
            } as UnitState);
        } else {
            const st = laneState.get(id)!;
            const ap = Number(u.approach);
            if (Number.isFinite(ap) && ap > 0) st.approachMax = Math.max(st.approachMax, ap, 1);
            // keep ownerUserId if present on the frame
            if ((u as any).ownerUserId) st.ownerUserId = String((u as any).ownerUserId ?? "");
        }
    }

    const all = Array.from(laneState.values()).sort((a, b) => a.approachMax - b.approachMax || a.id.localeCompare(b.id));

    for (const st of all) {
        const f0 = map0.get(st.id);
        const f1 = map1.get(st.id);

        const denom = Math.max(1, Number(st.approachMax ?? frame.ticksToReach ?? 1));
        const a0 = f0 ? Number(f0.approach) : denom;
        const a1 = f1 ? Number(f1.approach) : a0;

        let approachVal = a0 + (a1 - a0) * alpha;
        if (!Number.isFinite(approachVal)) approachVal = denom;
        approachVal = Math.max(0, Math.min(denom, approachVal));

        let progress = 1 - approachVal / denom;
        progress = Math.max(0, Math.min(1, progress));

        const unitW = 6;
        const lanePad = 40;

        const startX = displayLane === 0 ? lanePad : w - lanePad - unitW;
        const endX = displayLane === 0 ? towerX - unitW - 2 : towerX + towerW + 2;

        let x = Math.floor(startX + (endX - startX) * progress);
        x = Math.max(0, Math.min(w - unitW, x));

        const y = h / 2 + (hashId(String(st.id)) % 5) * 4 - 8;

        if (st.alive) {
            const img = unitImgs.get(st.type) ?? unitImgs.get("placeholder") ?? null;
            drawUnit(ctx, img ?? null, x, y, 6, 6, st);
        } else {
            const ds = st.deathStartTs ?? 0;
            const life = st.deathLifeMs ?? 600;
            const t = Math.min(1, Math.max(0, (now - ds) / life));
            const a = 1 - t;
            if (a > 0) {
                ctx.save();
                ctx.globalAlpha = a;
                ctx.fillStyle = "#6b7280";
                ctx.fillRect(x, y, 6, 6);
                ctx.restore();
            }
        }
    }

    for (const [id, st] of Array.from(laneState.entries())) {
        if (!st.alive && st.deathStartTs) {
            const expired = now - st.deathStartTs > (st.deathLifeMs ?? 600);
            const stillInFrames = map0.has(id) || map1.has(id);
            if (expired && !stillInFrames) laneState.delete(id);
        }
    }

    const remaining: Popup[] = [];
    for (const p of popups) {
        if (p.displayLane !== displayLane) {
            remaining.push(p);
            continue;
        }
        if (now < p.bornAt) {
            remaining.push(p);
            continue;
        }
        const elapsed = now - p.bornAt;
        if (elapsed >= p.lifeMs) continue;
        const t = elapsed / p.lifeMs;
        const dy = -(1 - Math.pow(1 - t, 2)) * 36;
        const a = 1 - t;
        drawPopup(ctx, p.text, towerX + 16, towerY + 22 + dy, p.color, a);
        remaining.push(p);
    }

    const others = popups.filter((p) => p.displayLane !== displayLane);
    popups.length = 0;
    popups.push(...remaining.concat(others));

    const seen = new Set<string>();
    for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        const k = `${p.displayLane}:${p.bornAt}:${p.text}:${p.staggerIdx}`;
        if (seen.has(k)) popups.splice(i, 1);
        else seen.add(k);
    }
}

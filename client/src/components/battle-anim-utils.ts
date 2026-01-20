/**
 * battle-anim-utils.ts
 *
 * Small helper types and rendering primitives used by the battle animation
 * system. Includes light-weight image helpers, hashing, unit seeding and
 * simple drawing primitives that can be used in tests.
 */

export type UnitFrame = {
    id: string | number;
    approach: number;
    type: string;
    hp?: number;
    maxHp?: number;
    ownerUserId?: string
};

export type BattleFrame = {
    tick: number;
    ticksToReach: number;
    aUnits: UnitFrame[];
    bUnits: UnitFrame[];
    projectiles: { x: number; y: number }[];
};

export type UnitState = {
    id: string;
    type: string;
    hp: number;
    maxHp: number;
    alive: boolean;
    ownerUserId?: string;
    approachMax: number;
    deathStartTs?: number;
    deathLifeMs?: number;
};

export type Popup = {
    text: string;
    bornAt: number;
    lifeMs: number;
    color: string;
    displayLane: 0 | 1;
    staggerIdx: number
};

/**
 * Normalize tower color strings into the limited palette used by the renderer
 */
export function normTowerColor(c: any): "red" | "blue" {
    const s = String(c ?? "").toLowerCase();
    return s === "red" ? "red" : "blue";
}

/**
 * Construct a tower sprite path for a given color and level (tier mapping).
 */
export function buildTowerSprite(color: "red" | "blue", level: number) {
    const c = color === "red" ? "Red" : "Blue";
    const lvl = level ?? 1;
    const tier = lvl >= 5 ? 3 : lvl >= 3 ? 2 : 1;
    return `/assets/${c}Tower${tier}.png`;
}

/**
 * Create an Image element with safe error handling.
 */
export function createImage(src: string) {
    const img = new Image();
    img.src = src;
    img.onerror = () => {
    };
    return img;
}

/**
 * Simple FNV-like string hash used to scatter units vertically in the lane.
 */
export function hashId(id: string) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

/**
 * Seed a Map of UnitState objects from a canonical UnitFrame array.
 */
export function seedUnitStates(map: Map<string, UnitState>, src: UnitFrame[] | any[], frameTicks: number) {
    const defaultHp = (t: string) => (t === "ogre" ? 25 : 10);
    for (const u of src) {
        const id = String(u.id);
        const type = String(u.type ?? "goblin");
        const hp = typeof u.hp === "number" ? u.hp : defaultHp(type);
        const maxHp = typeof u.maxHp === "number" ? u.maxHp : hp;
        const approach = Number(u.approach);
        const approachMax = Number.isFinite(approach) && approach > 0 ? approach : (frameTicks ?? 10);
        map.set(id, {
            id,
            type,
            hp,
            maxHp,
            ownerUserId: String((u as any).ownerUserId ?? ""),
            alive: hp > 0,
            approachMax: Math.max(1, approachMax),
        });
    }
}

// --- Scheduler helper: enrich events with _tickIndex based on sim tick size ---
/**
 * Convert events with atMsOffset into a stable ordering and attach `_tickIndex`
 * based on a simulation tick size.
 */
export function enrichEventsWithTickIndex(events: any[], ticksToReach: number, simTickMs = 100) {
    if (!Array.isArray(events)) return [];
    const ordered = [...events].slice().sort((a, b) => Number(a.atMsOffset ?? 0) - Number(b.atMsOffset ?? 0));
    return ordered.map((ev) => {
        const offset = Number(ev.atMsOffset ?? 0) || 0;
        const tickIndex = Math.max(0, Math.min(ticksToReach, Math.round(offset / simTickMs)));
        return {...ev, _tickIndex: tickIndex};
    });
}

// --- Simple renderer primitives to allow unit-testing drawing logic ---
/**
 * Draw a tower sprite (or fallback rectangle) to canvas.
 */
export function drawTower(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, w: number, h: number, flashAlpha = 0) {
    if (img && img.complete && img.naturalWidth > 0) ctx.drawImage(img, x, y, w, h);
    else {
        ctx.fillStyle = "#111827";
        ctx.fillRect(x, y, w, h);
    }
    if (flashAlpha && flashAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, flashAlpha));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y, w, h);
        ctx.restore();
    }
}

/**
 * Draw a small unit tile and an HP bar when state is provided.
 */
export function drawUnit(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, w: number, h: number, state?: UnitState) {
    if (state == null) state = undefined as any;
    if (img && img.complete && img.naturalWidth > 0) ctx.drawImage(img, x, y, w, h);
    else {
        ctx.fillStyle = (state?.type === "ogre") ? "#7c2d12" : "#166534";
        ctx.fillRect(x, y, w, h);
    }

    if (state && Number.isFinite(state.hp) && Number.isFinite(state.maxHp)) {
        const barW = Math.max(8, Math.round(w * 2));
        const frac = Math.max(0, Math.min(1, (state.hp ?? 0) / Math.max(1, state.maxHp ?? 1)));
        ctx.fillStyle = "#00000088";
        ctx.fillRect(x - 3, y - 6, barW, 3);
        ctx.fillStyle = "#10b981";
        ctx.fillRect(x - 3, y - 6, Math.max(0, Math.round(barW * frac)), 3);
    }
}

/**
 * Draw a floating popup text with stroke/background for readability.
 */
export function drawPopup(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 16px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = color;
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
}

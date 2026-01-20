/**
 * card-utils.ts
 *
 * Small helpers to build a compact stats string for a card and compute derived
 * display values (buff percent). These helpers are intentionally simple and
 * string-serializable for use in component attributes.
 */

import type {MatchCard} from "../types/card-types";

/**
 * Convert a buff multiplier (e.g. 1.5) into an integer percentage delta (50).
 * @param multiplier - the buff multiplier or null/undefined
 * @returns percentage increase (0 if multiplier is missing or <=1)
 */
export function buffPercent(multiplier: number | null | undefined): number {
    if (multiplier == null) return 0;
    return Math.round((multiplier - 1) * 100);
}

/**
 * Build a short, human-readable stats string for a card used in the UI.
 * The returned text is intended to be compact and suitable for the card
 * template's `stats` slot.
 *
 * The function understands several config kinds used by the server (for
 * example `hp_permanent`, `dps_permanent`, `gold_per_round`, `extra_draw_next_round`)
 * and falls back to generic labels when the exact config is unknown.
 *
 * @param c - the match card object
 * @returns a succinct stats description (may be empty)
 */
export function buildStats(c: MatchCard & any): string {
    if (c.type === "attack") {
        const parts: string[] = [];
        if (c.baseDamage != null) {
            parts.push(`Base dmg ${c.baseDamage}`);
        }
        if (c.config?.enemies != null && c.config?.enemyType) {
            const plural = c.config.enemies === 1 ? "" : "s";
            parts.push(`${c.config.enemies} ${c.config.enemyType}${plural}`);
        }
        if (c.config?.damagePerEnemy != null) {
            parts.push(`${c.config.damagePerEnemy} dmg each`);
        }
        return parts.join(" • ");
    }

    if (c.type === "defense") {
        const targetKey = c.config?.target;
        if (c.baseHpBonus != null && c.config?.kind === "hp_permanent") {
            return `+${c.baseHpBonus} HP (permanent)`;
        }
        if (c.baseDpsBonus != null && c.config?.kind === "dps_permanent") {
            return `+${c.baseDpsBonus} DPS (permanent)`;
        }

        if (targetKey === "marry_refusal") {
            return "Special refusal event";
        }

        return "Defense boost";
    }

    if (c.type === "buff") {
        const mult = c.buffMultiplier ?? 1;
        const percent = Math.round((mult - 1) * 100);
        const targetKey = c.config?.target;

        if (targetKey === "marry_proposal") {
            return "Special proposal event";
        }

        const targetLabel = (() => {
            switch (targetKey) {
                case "all_attacks_next_round":
                    return "all attacks next round";
                case "next_attack":
                    return "next attack";
                case "next_defense":
                    return "next defense";
                default:
                    return "next effect";
            }
        })();

        if (percent > 0) {
            return `+${percent}% ${targetLabel}`;
        }

        return `Buff: ${targetLabel}`;
    }

    if (c.type === "economy") {
        if (c.economyBonus != null && c.config?.kind === "gold_per_round") {
            return `+${c.economyBonus} gold / round`;
        }
        if (
            c.config?.kind === "extra_draw_next_round" &&
            c.config?.extraDraw != null
        ) {
            return `Draw +${c.config.extraDraw} next round`;
        }
        return "Economy boost";
    }
    return "";
}

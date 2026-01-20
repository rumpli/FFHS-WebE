/**
 * effects.ts
 *
 * Functions that apply card effects into a player's match state. Effects are
 * applied deterministically and mutate the provided `MatchPlayerStateJson`.
 * The file focuses on non-combat card types like `ECONOMY` and `BUFF` which
 * alter pending state used by the match simulator.
 */

import type {MatchPlayerStateJson} from "../ws/matchState.js";
import type {CardDefinition} from "@prisma/client";

export function applyCardEffect(state: MatchPlayerStateJson, card: Pick<CardDefinition, 'id' | 'type' | 'buffMultiplier' | 'config'>): MatchPlayerStateJson {
    if (card.type === 'ECONOMY') {
        const cfg = (card.config as any) ?? {};
        // extra_draw_next_round: queue an extra draw count consumed at round transition
        if (cfg && cfg.kind === 'extra_draw_next_round') {
            const extra = Math.max(0, Math.floor(Number(cfg.extraDraw ?? 1) || 0));
            (state as any).pendingExtraDraws = (Number((state as any).pendingExtraDraws ?? 0) || 0) + extra;
            return state;
        }
        // gold_per_round: augment per-round gold and increase maxGold cap
        if (cfg && cfg.kind === 'gold_per_round') {
            const extraGold = Math.max(0, Math.floor(Number(cfg.goldPerRound ?? cfg.extraGold ?? 0) || 0));
            (state as any).goldPerRound = (Number((state as any).goldPerRound ?? 0) || 0) + extraGold;
            const prevMax = Number((state as any).maxGold ?? 10) || 10;
            (state as any).maxGold = prevMax + extraGold;
            return state;
        }
    }
    if (card.type === 'BUFF') {
        const pending = (state as any).pendingBuffs as any[] | undefined;
        const cfg = (card.config as any) ?? {};
        // Buff multiplier may be on the typed field or inside config
        const mul = typeof card.buffMultiplier === 'number' ? Number(card.buffMultiplier) : (Number(cfg.multiplier) || 1);
        // Normalize target into 'tower' or 'units'
        const rawTarget = (cfg && typeof cfg.target === 'string') ? String(cfg.target) : '';
        let target: 'tower' | 'units' = 'units';
        if (rawTarget === 'tower' || rawTarget === 'units') target = rawTarget as 'tower' | 'units';
        else if (rawTarget === 'all_attacks_next_round' || rawTarget === 'next_attack' || rawTarget === 'units_next_round') target = 'units';
        else if (rawTarget === 'tower_next_round' || rawTarget === 'next_defense') target = 'tower';
        const entry = {cardId: card.id, multiplier: Number(mul) || 1, target, config: cfg};
        if (Array.isArray(pending)) {
            pending.push(entry);
        } else {
            (state as any).pendingBuffs = [entry];
        }
    }
    return state;
}

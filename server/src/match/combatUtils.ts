/**
 * combatUtils.ts
 *
 * Small combat helper utilities. Currently includes a function to compute the
 * outgoing damage of a player's board by summing attack-capable card damage
 * scaled by merge/stack counts.
 */

export function computeOutgoingDamage(boardSlots: Array<{
    cardId: string | null;
    stackCount?: number
}>, defMap: Map<string, { baseDamage?: number | null; type?: string | null }>) {
    let outgoing = 0;
    for (const slot of boardSlots) {
        if (!slot.cardId) continue;
        const def = defMap.get(slot.cardId);
        if (!def) continue;
        if (def.type !== 'ATTACK') continue;
        const base = (def.baseDamage ?? 0) as number;
        const mergeCount = slot.stackCount ?? 0;
        // Damage scales approximately linearly with merge count (base * (1 + mergeCount))
        outgoing += Math.round(base * (1 + mergeCount));
    }
    return outgoing;
}

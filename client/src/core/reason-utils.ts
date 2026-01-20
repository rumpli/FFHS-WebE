/**
 * reason-utils.ts
 *
 * Helper utilities that map elimination reason codes to localized/templatized
 * strings or detect special reasons such as marry_refusal.
 */

export function isMarryReason(note?: string | null, eliminationReason?: string | null): boolean {
    const e = String(eliminationReason ?? '');
    return e === 'marry_refusal';
}

export function mapEliminationReason(reason?: string | null, forWinner = false): string | undefined {
    if (!reason) return undefined;
    switch (String(reason)) {
        case 'marry_refusal':
            return forWinner ? `Your opponent couldn't say no to you.` : `You didn't refuse to marry.`;
        case 'marry_proposal':
            return undefined;
        case 'tower_destroyed':
            return forWinner ? 'Opponent tower destroyed' : 'Your tower was destroyed';
        case 'timeout':
            return forWinner ? 'Opponent timed out' : 'Timed out';
        case 'forfeit':
            return forWinner ? 'Opponent forfeited' : 'You forfeited the match';
        case 'eliminated_by_damage':
            return forWinner ? 'Opponent was defeated in battle' : 'Defeated in battle';
        default:
            return undefined;
    }
}

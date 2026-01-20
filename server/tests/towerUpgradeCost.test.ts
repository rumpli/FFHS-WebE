/**
 * towerUpgradeCost.test.ts
 *
 * Unit tests for `towerUpgradeCostForRound` verifying cost scaling with round
 * and last upgrade round to ensure minimum cost enforcement and decreasing cost.
 */

import {describe, it, expect} from 'vitest';
import {towerUpgradeCostForRound, DEFAULT_TOWER_UPGRADE_COST} from '../src/ws/matchState.js';

describe('towerUpgradeCostForRound', () => {
    it('returns default when never upgraded', () => {
        expect(towerUpgradeCostForRound(1, 0)).toBe(DEFAULT_TOWER_UPGRADE_COST);

        expect(towerUpgradeCostForRound(5, 0)).toBe(DEFAULT_TOWER_UPGRADE_COST - 4);
    });

    it('keeps default on the upgrade round and the following round, then decreases by 1 each subsequent round', () => {

        const last = 1;
        expect(towerUpgradeCostForRound(1, last)).toBe(DEFAULT_TOWER_UPGRADE_COST);
        expect(towerUpgradeCostForRound(2, last)).toBe(DEFAULT_TOWER_UPGRADE_COST - 1);

        expect(towerUpgradeCostForRound(3, last)).toBe(DEFAULT_TOWER_UPGRADE_COST - 2);
    });

    it('does not drop below floor (3)', () => {
        const last = 1;

        const cost = towerUpgradeCostForRound(100, last);
        expect(cost).toBeGreaterThanOrEqual(3);
        expect(cost).toBe(3);
    });

    it('returns default when currentRound <= lastUpgradeRound + 1', () => {
        expect(towerUpgradeCostForRound(3, 5)).toBe(DEFAULT_TOWER_UPGRADE_COST);
        expect(towerUpgradeCostForRound(5, 5)).toBe(DEFAULT_TOWER_UPGRADE_COST);
    });
});

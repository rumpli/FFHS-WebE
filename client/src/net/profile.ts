/**
 * profile.ts
 *
 * Network helper for fetching a player's public profile. Uses an `inFlight`
 * cache to deduplicate concurrent requests for the same player+query.
 */


import type {PlayerProfile} from '../../../shared/protocol/types/profile.js';
import {getToken} from '../auth/auth.js';

const API_URL = (window as any).__CFG__?.API_URL ?? '';

const inFlight: Map<string, Promise<any>> = new Map();

/**
 * Fetch a player's profile. Returns { profile, pagination }.
 * Concurrent calls with identical parameters are deduplicated.
 */
export async function fetchPlayerProfile(playerId: string, opts: { limit?: number, page?: number } = {}) {
    const q = new URLSearchParams();
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.page) q.set('page', String(opts.page));
    const key = `${playerId}::${q.toString()}`;
    if (inFlight.has(key)) return inFlight.get(key)!;

    const url = `${API_URL}/players/${encodeURIComponent(playerId)}/profile?${q.toString()}`;

    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const p = (async () => {
        const res = await fetch(url, {credentials: 'include', headers});
        if (!res.ok) throw new Error('Failed to fetch player profile');
        const body = await res.json();
        return {
            profile: body.profile as PlayerProfile,
            pagination: body.pagination as { page: number; limit: number; hasMore: boolean }
        };
    })();
    inFlight.set(key, p);
    p.finally(() => inFlight.delete(key));
    return p;
}

export {};

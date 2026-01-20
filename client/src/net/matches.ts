/**
 * matches.ts
 *
 * Network helpers for fetching archived match results and a player's match
 * history from the backend API. These are thin wrappers around fetch and
 * return parsed JSON payloads.
 */

import type {StoredMatchResult} from '../../../shared/protocol/types/matchResult.js';

const API_URL = (window as any).__CFG__?.API_URL ?? '';

/**
 * Fetch a stored match result by id.
 * @param matchId - the id of the stored match
 * @param includeEvents - whether to include the event stream in the response
 */
export async function fetchMatchResult(matchId: string, includeEvents = false): Promise<StoredMatchResult> {
    const url = `${API_URL}/matches/${encodeURIComponent(matchId)}?includeEvents=${includeEvents ? 'true' : 'false'}`;
    const res = await fetch(url, {credentials: 'include'});
    if (!res.ok) throw new Error('Failed to fetch match result');
    const body = await res.json();
    return body.result as StoredMatchResult;
}

/**
 * Fetch a paginated list of matches for a player.
 * Returns the raw `matches` array from the API response.
 */
export async function fetchPlayerMatches(playerId: string, opts: { limit?: number, page?: number } = {}) {
    const q = new URLSearchParams();
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.page) q.set('page', String(opts.page));
    const url = `${API_URL}/players/${encodeURIComponent(playerId)}/matches?${q.toString()}`;
    const res = await fetch(url, {credentials: 'include'});
    if (!res.ok) throw new Error('Failed to fetch player matches');
    const body = await res.json();
    return body.matches;
}

export {};

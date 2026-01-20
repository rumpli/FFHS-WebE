/**
 * auth.ts
 *
 * Utility helpers for storing and broadcasting the authentication token.
 * This module wraps localStorage access and dispatches a DOM CustomEvent
 * named 'auth:token-changed' whenever the token is set or cleared so that
 * other parts of the application can react to authentication state changes.
 */

import {debug} from '../core/log'

// Key used in localStorage for persisting the auth token.
const TOKEN_KEY = "towerlords_token";

/**
 * Persist the authentication token and notify the app about the change.
 *
 * @param token - The authentication token (e.g. JWT) to store.
 */
export function setToken(token: string) {
    debug("Setting token:", token);
    localStorage.setItem(TOKEN_KEY, token);
    try {
        // Broadcast token change to interested parts of the app (UI, network layer, etc.).
        window.dispatchEvent(new CustomEvent('auth:token-changed', {detail: token}));
    } catch (err) {
        // Some environments may throw when creating or dispatching CustomEvent;
        // log the error for diagnostics but don't break app flow.
        try {
            debug('Failed to dispatch auth:token-changed event', err);
        } catch {
        }
    }
}

/**
 * Read the currently stored authentication token.
 *
 * @returns The token string if present, or null when absent.
 */
export function getToken(): string | null {
    debug("Getting token:", TOKEN_KEY);
    return localStorage.getItem(TOKEN_KEY);
}

/**
 * Remove the stored authentication token and notify listeners.
 */
export function clearToken() {
    debug("Clearing token");
    localStorage.removeItem(TOKEN_KEY);
    try {
        // Notify listeners that the token was removed by sending `null`.
        window.dispatchEvent(new CustomEvent('auth:token-changed', {detail: null}));
    } catch (err) {
        try {
            debug('Failed to dispatch auth:token-changed event', err);
        } catch {
        }
    }
}

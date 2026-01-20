/**
 * chatPersist.ts
 *
 * Utilities to persist simple chat UI state (unread count, last-read-ts)
 * per-scope (match or lobby) in localStorage.
 */

import {state} from './store';

const KEY_PREFIX = 'towerlords_chat_v1:';

type PersistedChatUi = {
    unreadCount: number;
    lastReadTs?: number;
};

function keyFor(scope: string, id: string) {
    return `${KEY_PREFIX}${scope}:${id}`;
}

export function loadChatUi(scope: 'match' | 'lobby', id: string): PersistedChatUi | null {
    try {
        const raw = localStorage.getItem(keyFor(scope, id));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const unreadCount = Number((parsed as any).unreadCount ?? 0);
        const lastReadTs = (parsed as any).lastReadTs;
        return {
            unreadCount: Number.isFinite(unreadCount) ? unreadCount : 0,
            lastReadTs: typeof lastReadTs === 'number' ? lastReadTs : undefined,
        };
    } catch {
        return null;
    }
}

export function saveChatUi(scope: 'match' | 'lobby', id: string, ui: PersistedChatUi) {
    try {
        localStorage.setItem(keyFor(scope, id), JSON.stringify(ui));
    } catch {
    }
}

export function clearChatUi(scope: 'match' | 'lobby', id: string) {
    try {
        localStorage.removeItem(keyFor(scope, id));
    } catch {
    }
}

/** Persist current unread count for the active chat scope/id */
export function persistUnread() {
    const scope = state.chat.scope;
    const id = state.chat.id;
    if (!id) return;
    const prev = loadChatUi(scope, id);
    saveChatUi(scope, id, {
        unreadCount: state.chat.unreadCount,
        lastReadTs: prev?.lastReadTs,
    });
}

/** Mark chat as read now and persist a lastReadTs */
export function persistReadNow() {
    const scope = state.chat.scope;
    const id = state.chat.id;
    if (!id) return;
    saveChatUi(scope, id, {
        unreadCount: 0,
        lastReadTs: Date.now(),
    });
}

/**
 * EventBus.ts
 *
 * Tiny typed event bus used across the client for lightweight pub/sub between
 * modules and UI components. Methods: on(topic,handler) => offFn, off(topic,handler), emit(topic,payload).
 */

type Handler = (p: any) => void;

export class EventBus {
    private m = new Map<string, Set<Handler>>();

    on(t: string, h: Handler) {
        if (!this.m.has(t)) this.m.set(t, new Set());
        this.m.get(t)!.add(h);
        return () => this.off(t, h);
    }

    off(t: string, h: Handler) {
        this.m.get(t)?.delete(h);
    }

    emit(t: string, p: any) {
        this.m.get(t)?.forEach(h => h(p));
    }
}

export const bus = new EventBus();

/**
 * log.ts
 *
 * Minimal logging helpers. `debug` is gated by a flag and avoids throwing in
 * environments without console.
 */

const VITE_LOG_DEBUG = typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_LOG_DEBUG : undefined;

/**
 * Logs debug messages to the console if the debug flag is enabled.
 * @param args - The messages to log.
 */
export function debug(...args: any[]) {
    try {
        const enabled = (typeof window !== 'undefined' && (window as any).__LOG_DEBUG === true) || (typeof VITE_LOG_DEBUG !== 'undefined' && VITE_LOG_DEBUG === '1');
        if (enabled) console.log(...args);
    } catch (e) {
    }
}

/**
 * Logs informational messages to the console.
 * @param args - The messages to log.
 */
export function info(...args: any[]) {
    console.log(...args);
}

/**
 * Logs warning messages to the console.
 * @param args - The messages to log.
 */
export function warn(...args: any[]) {
    console.warn(...args);
}

/**
 * Logs error messages to the console.
 * @param args - The messages to log.
 */
export function error(...args: any[]) {
    console.error(...args);
}

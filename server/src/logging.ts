/**
 * logging.ts
 *
 * Lightweight logging helpers used across the server. Implemented on top of
 * console to keep the dependency surface small for grading and simple
 * deployments. Environment variable `LOG_DEBUG` enables verbose debug logs.
 */

export function debug(...args: any[]) {
    try {
        if (process.env.LOG_DEBUG === '1' || process.env.LOG_DEBUG === 'true') {
            console.log(...args);
        }
    } catch (e) {
    }
}

export function info(...args: any[]) {
    console.log(...args);
}

export function warn(...args: any[]) {
    console.warn(...args);
}

export function error(...args: any[]) {
    console.error(...args);
}

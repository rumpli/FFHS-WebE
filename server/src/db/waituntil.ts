/**
 * waituntil.ts
 *
 * Tiny helper to retry an async predicate until success or until attempts are
 * exhausted. Logs warnings via the provided Fastify logger for each failure
 * attempt. Useful to wait for dependent infra (DB, Redis) to become ready at
 * startup.
 */

import type {FastifyBaseLogger} from "fastify";

export async function waitUntil<T>(
    fn: () => Promise<T>,
    name: string,
    log: FastifyBaseLogger,
    attempts = 30,
    delayMs = 1000,
): Promise<T> {
    for (let i = 1; i <= attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            log.warn({err: (e as Error).message, attempt: i}, `${name} not ready`);
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
    throw new Error(`${name} not ready after ${attempts} attempts`);
}
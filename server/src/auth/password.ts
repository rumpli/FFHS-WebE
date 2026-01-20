/**
 * password.ts
 *
 * Thin wrapper around `bcryptjs` used to hash and verify user passwords.
 * Exposes two async helpers: `hashPassword` and `verifyPassword`.
 */

import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
}

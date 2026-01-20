/**
 * jwt.ts
 *
 * Minimal JWT helpers to sign and verify access tokens used by the API. Keys
 * are read from `process.env.JWT_SECRET` with a sensible default for local
 * development; production deployments should override this secret.
 */

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const JWT_EXPIRES_IN = "7d";

export interface JwtPayload {
    sub: string;
    username: string;
}

/**
 * Create a signed JWT access token from the provided payload.
 * @param payload - minimal payload containing `sub` and `username`
 * @returns signed JWT string
 */
export function signAccessToken(payload: JwtPayload): string {
    return jwt.sign(payload, JWT_SECRET, {expiresIn: JWT_EXPIRES_IN});
}

/**
 * Verify and decode an access token. Throws if verification fails.
 * @param token - signed JWT
 * @returns decoded payload
 */
export function verifyAccessToken(token: string): JwtPayload {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

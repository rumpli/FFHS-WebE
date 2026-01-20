/**
 * httpAuth.ts
 *
 * Small helper to extract and verify a bearer access token from an incoming
 * Fastify request and resolve the corresponding `User` record from the
 * database. Returns `null` when no valid user could be resolved.
 */

import type {FastifyRequest} from "fastify";
import {verifyAccessToken} from "./jwt.js";
import {prisma} from "../db/prisma.js";

/**
 * Inspect the `Authorization: Bearer <token>` header on the provided request,
 * verify the token and return the user record (selected fields only). If the
 * header is missing, malformed, or the token verification fails, `null` is
 * returned.
 *
 * @param req - incoming Fastify request
 * @returns user object or null
 */
export async function getUserFromRequest(req: FastifyRequest) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return null;
    const token = auth.substring("Bearer ".length).trim();
    if (!token) return null;
    try {
        const payload = verifyAccessToken(token);
        return await prisma.user.findUnique({
            where: {id: payload.sub},
            select: {
                id: true,
                username: true,
                email: true,
                createdAt: true,
                gamesPlayed: true,
                gamesWon: true,
                totalDamageOut: true,
                totalDamageTaken: true,
                maxSurvivalRound: true,
                xp: true,
                level: true,
            },
        });
    } catch {
        // Token verification or DB lookup failed — treat as unauthenticated
        return null;
    }
}
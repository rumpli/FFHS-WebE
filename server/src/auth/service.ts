/**
 * service.ts
 *
 * Authentication service functions used by the HTTP handlers: `registerUser`
 * and `loginUser`. These functions validate input using the Zod schemas and
 * return a compact user object together with a signed access token.
 */

import {prisma} from "../db/prisma.js";
import {hashPassword, verifyPassword} from "./password.js";
import {signAccessToken} from "./jwt.js";
import {registerSchema} from "../schemas/register.js";
import {loginSchema} from "../schemas/login.js";

export async function registerUser(raw: unknown) {
    const {username, email, password} = registerSchema.parse(raw);
    const existing = await prisma.user.findFirst({
        where: {
            OR: [{username}, {email}],
        },
    });
    if (existing) {
        // Caller maps this error string to an HTTP 400 / conflict response
        throw new Error("USERNAME_OR_EMAIL_TAKEN");
    }
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
        data: {username, email, passwordHash},
        select: {
            id: true,
            username: true,
            email: true,
            createdAt: true,
        },
    });
    const token = signAccessToken({sub: user.id, username: user.username});
    return {user, token};
}

export async function loginUser(raw: unknown) {
    const {usernameOrEmail, password} = loginSchema.parse(raw);
    const user = await prisma.user.findFirst({
        where: {
            OR: [
                {username: usernameOrEmail},
                {email: usernameOrEmail},
            ],
        },
    });
    if (!user) {
        throw new Error("INVALID_CREDENTIALS");
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
        throw new Error("INVALID_CREDENTIALS");
    }
    const token = signAccessToken({sub: user.id, username: user.username});
    return {
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            createdAt: user.createdAt,
        },
        token,
    };
}

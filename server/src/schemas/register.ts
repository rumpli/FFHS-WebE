/**
 * register.ts
 *
 * Zod schema for user registration input. Validates `username`, `email` and
 * `password` against conservative patterns chosen to improve account security
 * and reduce invalid usernames.
 */

import {z} from "zod";

const usernamePattern = /^[a-zA-Z0-9._-]{3,32}$/;
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{12,}$/;

export const registerSchema = z.object({
    username: z
        .string()
        .trim()
        .regex(usernamePattern, {message: "Username must be 3-32 chars and use letters, digits, dot, hyphen, or underscore."}),
    email: z.string().trim().email({message: "Provide a valid email address."}),
    password: z
        .string()
        .refine((value) => passwordPattern.test(value), {
            message: "Password must be 12+ chars with upper, lower, digit, and symbol.",
        }),
});
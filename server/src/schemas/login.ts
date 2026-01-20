/**
 * login.ts
 *
 * Zod schema used to validate login requests. Allows either username or email
 * (username defined by `usernamePattern`) and validates password strength with
 * a conservative policy. The same password policy is used for registration.
 */

import {z} from "zod";

/**
 * Pattern to validate usernames.
 * - Allows letters, digits, dots, underscores, and hyphens.
 * - Length between 3 and 32 characters.
 */
const usernamePattern = /^[a-zA-Z0-9._-]{3,32}$/;

/**
 * Pattern to validate passwords.
 * - At least 12 characters long.
 * - Must contain at least one lowercase letter, one uppercase letter, one digit,
 *   and one special character (non-word character).
 */
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{12,}$/;

export const loginSchema = z.object({
    usernameOrEmail: z
        .string()
        .trim()
        .refine(
            (value) => usernamePattern.test(value) || z.string().email().safeParse(value).success,
            {message: "Provide a valid username or email."}
        ),
    password: z
        .string()
        .refine((value) => passwordPattern.test(value), {
            message:
                "Password must be 12+ chars with upper, lower, digit, and symbol.",
        }),
});
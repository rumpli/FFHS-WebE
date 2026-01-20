/**
 * register.ts
 *
 * HTTP route registration for user registration. Exposes `/api/register` and
 * relies on `registerUser` from `auth/service`. Maps known service errors to
 * appropriate HTTP status codes and JSON error payloads.
 */

import type {FastifyInstance} from "fastify";
import {registerUser} from "../auth/service.js";

export async function registerRegisterRoutes(app: FastifyInstance) {
    app.post("/api/register", async (req, reply) => {
        try {
            const result = await registerUser(req.body);
            app.log.info({userId: result.user.id}, "new user) registered");
            return reply
                .code(201)
                .send({ok: true, user: result.user, token: result.token});
        } catch (err: any) {
            if (err?.message === "USERNAME_OR_EMAIL_TAKEN") {
                app.log.error(err.message);
                return reply.code(409).send({
                    ok: false,
                    error: "USERNAME_OR_EMAIL_TAKEN",
                    msg: "Username or email already in use.",
                });
            }
            if (err?.name === "ZodError") {
                app.log.error(err.message);
                return reply.code(400).send({
                    ok: false,
                    error: "VALIDATION_ERROR",
                    issues: err.issues,
                });
            }
            app.log.error({err}, "register failed");
            return reply.code(500).send({ok: false, error: "INTERNAL_ERROR"});
        }
    });
}

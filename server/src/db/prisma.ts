/**
 * prisma.ts
 *
 * Exports a shared `PrismaClient` instance used across the server. The client
 * reads its connection configuration from the runtime Prisma configuration or
 * environment variables — do not create multiple PrismaClient instances in
 * serverless environments.
 */

import {PrismaClient} from "@prisma/client";

export const prisma = new PrismaClient();
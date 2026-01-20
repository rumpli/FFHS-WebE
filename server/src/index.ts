/**
 * index.ts
 *
 * Server entrypoint. Responsibilities:
 * - Configure and start the Fastify HTTP server
 * - Register middleware (CORS), telemetry proxy, static asset serving and
 *   WebSocket endpoint
 * - Initialize/close infra (database, telemetry, etc.)
 * - Schedule optional periodic diagnostics
 * - Provide graceful shutdown handlers for SIGINT / SIGTERM
 *
 * This file intentionally keeps wiring simple; the application logic is
 * delegated to route and ws modules.
 */

import Fastify from 'fastify';
import fastifyStatic from "@fastify/static";
import cors from '@fastify/cors';
import httpProxy from '@fastify/http-proxy';
import websocket from '@fastify/websocket';
import {initInfra, closeInfra} from './db/infra.js';
import {registerHttpRoutes} from './http/routes.js';
import {registerWs} from './ws/index.js';
import path from "node:path";
import {runLobbyDiagnostics} from './diagnostics/lobbies.js';

// Environment-configurable defaults; reading once near startup makes testing easier
const {
    PORT = '8080',
    OTEL_COLLECTOR_URL = 'http://otel-collector:4318',
    FRONTEND_ORIGIN = 'http://localhost:5173',
    LOBBY_DIAGNOSTICS_ENABLED = 'true',
    LOBBY_DIAGNOSTICS_INTERVAL_SECONDS = '60',
} = process.env;

// Create the Fastify instance. Keep logger level configurable via env.
const app = Fastify({
    logger: {
        level: process.env.FASTIFY_LOG_LEVEL ?? 'warn',
    },
});

// Initialize infra (database connections, prisma, etc.) before registering routes
await initInfra(app.log);

// Register CORS with a permissive single-origin configuration used by the dev front-end
await app.register(cors, {
    origin: FRONTEND_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
        "content-type",
        "authorization",
        "traceparent",
        "tracestate",
    ],
    maxAge: 86400,
});

// Expose an HTTP proxy for telemetry (OTLP) so the frontend or sidecars can forward
await app.register(httpProxy, {
    prefix: '/telemetry',
    upstream: OTEL_COLLECTOR_URL,
    http2: false,
});

// Serve static assets from `public/` (client build). Use long cache headers for immutable assets.
app.register(fastifyStatic, {
    root: path.join(process.cwd(), "public"),
    prefix: "/",
    maxAge: "1y",
    immutable: true,
});

// Websocket plugin (Fastify wrapper around `ws`)
await app.register(websocket);

// Register HTTP and WebSocket handlers from other modules
await registerHttpRoutes(app);
await registerWs(app);

// Optional periodic diagnostics (e.g. lobby pruning). Run in background if enabled.
let _lobbyDiagnosticsHandle: NodeJS.Timeout | null = null;
if (LOBBY_DIAGNOSTICS_ENABLED === 'true') {
    try {
        // Run once immediately and then schedule regular runs at the configured interval
        runLobbyDiagnostics().catch((e) => app.log.error(e));
        const interval = Math.max(10, Number(LOBBY_DIAGNOSTICS_INTERVAL_SECONDS));
        _lobbyDiagnosticsHandle = setInterval(() => {
            runLobbyDiagnostics().catch((e) => app.log.error(e));
        }, interval * 1000);
        app.log.info({intervalSeconds: interval}, 'lobby diagnostics scheduled');
    } catch (e) {
        app.log.error({err: e}, 'failed to start lobby diagnostics');
    }
}

// Graceful shutdown: stop diagnostics, close infra, and stop Fastify
const shutdown = async () => {
    app.log.info('shutting down...');
    if (_lobbyDiagnosticsHandle) {
        clearInterval(_lobbyDiagnosticsHandle);
        _lobbyDiagnosticsHandle = null;
    }
    await closeInfra(app.log);
    await app.close().catch(() => {
    });
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start listening on configured port/address
app.listen({port: Number(PORT), host: '0.0.0.0'}).catch((e) => {
    app.log.error(e);
});
/**
 * vite.config.ts
 *
 * Vite configuration for the frontend development server.
 * This file configures the dev server host/port and a few proxy rules that
 * forward API, websocket and telemetry requests to the backend service
 * (convenient when running the application in Docker or behind a reverse
 * proxy during local development).
 *
 * Notes:
 * - The proxy entries are used only by the Vite dev server. In production the
 *   real backend URL should be configured via the runtime `__CFG__` object or
 *   environment variables.
 * - WebSocket proxy (`/ws`) is marked with `ws: true` so Vite will upgrade
 *   the connection correctly.
 * - Tailwind integration is enabled via `@tailwindcss/vite` plugin.
 */

import {defineConfig} from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    // Dev server settings: port and host. `host: true` allows access from
    // other devices on the LAN (useful when testing on mobile).
    server: {
        port: 5173,
        host: true,
        // Proxy routes: map client-side requests to the backend service.
        // These entries make it convenient to call `/api` or `/ws` from the
        // front-end without CORS changes during development.
        proxy: {
            // Telemetry ingestion endpoint (OTEL or other collector)
            "/telemetry": {target: "http://backend:8080", changeOrigin: true},
            // Application API backend
            "/api": {target: "http://backend:8080", changeOrigin: true},
            // WebSocket endpoint for live updates (use `ws: true` for upgrades)
            "/ws": {target: "ws://backend:8080", ws: true, changeOrigin: true},
        },
    },
    // Plugins: Tailwind CSS integration for building the project's styles.
    plugins: [tailwindcss()],
});

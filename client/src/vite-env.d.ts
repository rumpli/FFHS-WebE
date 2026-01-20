/// <reference types="vite/client" />

/** Project-specific environment variables exposed to client code */
interface ImportMetaEnv {
    /** Optional health check URL used by dev/provisioning */
    readonly VITE_HEALTH_URL?: string
    /** Optional websocket URL override used in development */
    readonly VITE_WS_URL?: string
    /** When set to '1', log spans to console for debugging */
    readonly VITE_OTEL_DEBUG_CONSOLE?: string
    /** OpenTelemetry collector base URL (if present, tracing is enabled) */
    readonly VITE_OTEL_COLLECTOR_URL?: string
    /** When set to '1' enable debug logging in app */
    readonly VITE_LOG_DEBUG?: string
    /** Allow certain client-side actions (feature gating) */
    readonly VITE_ALLOW_CLIENT_END_ROUND?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

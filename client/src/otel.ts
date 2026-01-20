/**
 * otel.ts
 *
 * OpenTelemetry initialization for browser tracing. This module conditionally
 * initializes a WebTracerProvider and installs automatic instrumentations if
 * the `VITE_OTEL_COLLECTOR_URL` environment variable is provided.
 */

import {WebTracerProvider} from '@opentelemetry/sdk-trace-web';
import {BatchSpanProcessor, SimpleSpanProcessor, ConsoleSpanExporter} from '@opentelemetry/sdk-trace-base';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http';
import {detectResources, resourceFromAttributes} from '@opentelemetry/resources';
import {ATTR_SERVICE_NAME} from '@opentelemetry/semantic-conventions';
import {ZoneContextManager} from '@opentelemetry/context-zone';
import {trace} from '@opentelemetry/api';
import {registerInstrumentations} from '@opentelemetry/instrumentation';
import {getWebAutoInstrumentations} from '@opentelemetry/auto-instrumentations-web';
import {error, warn} from "./core/log";

if (!(window as any).__OTEL_INITIALIZED__) {
    (async () => {
        const collectorUrl = import.meta.env.VITE_OTEL_COLLECTOR_URL;
        if (!collectorUrl) {
            warn('OpenTelemetry: VITE_OTEL_COLLECTOR_URL is not defined, tracing disabled.');
            return;
        }
        const resource = (await detectResources()).merge(
            resourceFromAttributes({
                [ATTR_SERVICE_NAME]: 'towerlords-frontend',
            }),
        );
        const debugConsole = import.meta.env.VITE_OTEL_DEBUG_CONSOLE === '1';
        const provider = new WebTracerProvider({
            resource,
            spanProcessors: [
                ...(debugConsole
                    ? [
                        new SimpleSpanProcessor(new ConsoleSpanExporter()),
                    ]
                    : []),
                new BatchSpanProcessor(
                    new OTLPTraceExporter({
                        url: `${collectorUrl.replace(/\/$/, '')}/v1/traces`,
                    }),
                ),
            ],
        });

        // Register provider with a Zone-based context manager suitable for web apps
        provider.register({contextManager: new ZoneContextManager()});

        // Attempt to flush spans on visibility change and pagehide to avoid
        // losing spans when the page is closed or backgrounded.
        addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') provider.forceFlush();
        });
        addEventListener('pagehide', () => provider.forceFlush());

        // Install auto-instrumentations for common browser APIs (fetch / XHR / user interaction)
        registerInstrumentations({
            instrumentations: [
                getWebAutoInstrumentations({
                    '@opentelemetry/instrumentation-document-load': {enabled: true},
                    '@opentelemetry/instrumentation-user-interaction': {enabled: true},
                    '@opentelemetry/instrumentation-fetch': {
                        enabled: true,
                        propagateTraceHeaderCorsUrls: [
                            /^https?:\/\/localhost:\d+/,
                            /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}:\d+/,
                        ]
                    },
                    '@opentelemetry/instrumentation-xml-http-request': {enabled: true}
                }),
            ],
        });
        const tracer = trace.getTracer('app');
        const span = tracer.startSpan('otel:init');
        span.end();
    })().catch((e) => error('OpenTelemetry init failed:', e));
    (window as any).__OTEL_INITIALIZED__ = true;
}

/**
 * observability.ts
 *
 * Initialize OpenTelemetry SDK for tracing and metrics. This module sets up
 * an OTLP HTTP exporter for traces and metrics and enables automatic
 * instrumentation for Node.js libraries.
 *
 * The SDK is started eagerly during import; the application does not await
 * shutdown here (the process exit handler in `index.ts` handles infra
 * shutdown). For local development the OTLP collector URL is configurable
 * via env variables.
 */

import {NodeSDK} from '@opentelemetry/sdk-node';
import {getNodeAutoInstrumentations} from '@opentelemetry/auto-instrumentations-node';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http';
import {PeriodicExportingMetricReader} from '@opentelemetry/sdk-metrics';
import {OTLPMetricExporter} from '@opentelemetry/exporter-metrics-otlp-http';

const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? 'http://otel-collector:4318/v1/traces',
    }),
    metricReaders: [
        new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
                url: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? 'http://otel-collector:4318/v1/metrics',
            }),
            exportIntervalMillis: 10000,
        }),
    ],
    instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();

/**
 * metrics.ts
 *
 * Prometheus metrics registry and commonly used metrics for the server.
 * - `register` is the central `prom-client` Registry used by the `/metrics`
 *   endpoint exported elsewhere.
 * - Default process metrics are collected automatically.
 * - Application-specific counters/gauges/histograms are defined below and
 *   registered on the central registry.
 */

import client from 'prom-client';

export const register = new client.Registry();
// Collect default Node.js process metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({register});

// Counter: how many times a card has been played (labelled by id & type)
export const cardPlayedCounter = new client.Counter({
    name: 'card_played_total',
    help: 'Total number of times a card was played',
    labelNames: ['card_id', 'card_type'] as const,
    registers: [register],
});

// Gauge: number of open lobbies
export const lobbiesOpenGauge = new client.Gauge({
    name: 'lobbies_open',
    help: 'Number of currently open lobbies',
    registers: [register],
});

// Gauge: currently active matches
export const matchesActiveGauge = new client.Gauge({
    name: 'matches_active',
    help: 'Number of currently active matches',
    registers: [register],
});

// Histogram: finished match durations (seconds)
export const matchDurationHistogram = new client.Histogram({
    name: 'match_duration_seconds',
    help: 'Distribution of finished match durations in seconds',
    buckets: [30, 60, 120, 300, 600],
    registers: [register],
});

// Counter: how often a given deck is used to start a match
export const deckUsageCounter = new client.Counter({
    name: 'deck_usage_total',
    help: 'Count of matches started with a given deck',
    labelNames: ['deck_id'] as const,
    registers: [register],
});

// Counter: lobbies removed by diagnostics
export const lobbiesPrunedCounter = new client.Counter({
    name: 'lobbies_pruned_total',
    help: 'Total number of lobbies pruned/removed by diagnostics',
    registers: [register],
});

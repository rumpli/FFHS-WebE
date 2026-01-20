/**
 * routes.ts
 *
 * Central HTTP route registration. This file imports and composes all
 * individual route modules so the application's main server file can simply
 * call `registerHttpRoutes(app)` to wire the HTTP surface.
 */

import type {FastifyInstance} from 'fastify';
import {registerLoginRoutes} from './login.js';
import {registerRegisterRoutes} from './register.js';
import {registerHealthRoutes} from './health.js';
import {registerMeRoutes} from './me.js';
import {registerCardRoutes} from './cards.js';
import {registerDeckRoutes} from './decks.js';
import {registerMatchRoutes} from './handlers/matches.js';
import {registerLobbyRoutes} from './lobbies.js';
import {registerMetricsRoute} from './metrics.js';
import {registerProfileRoutes} from './handlers/profile.js';

export async function registerHttpRoutes(app: FastifyInstance) {
    await registerHealthRoutes(app);
    await registerMetricsRoute(app);
    await registerLoginRoutes(app);
    await registerRegisterRoutes(app);
    await registerMeRoutes(app);
    await registerCardRoutes(app);
    await registerDeckRoutes(app);
    await registerMatchRoutes(app);
    await registerLobbyRoutes(app);
    await registerProfileRoutes(app);
}

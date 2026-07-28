import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildAppOptions } from '../../src/app.js';

/** Builds an app for tests with dev-stub auth by default, so route tests don't
 * need to thread proxy headers through every request unless they're testing auth itself. */
export function buildTestApp(options: BuildAppOptions = {}): FastifyInstance {
  return buildApp({ authMode: 'dev-stub', ...options });
}

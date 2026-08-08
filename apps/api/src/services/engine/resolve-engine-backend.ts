import type { Kysely } from 'kysely';
import * as usersRepo from '../../db/repositories/users.js';
import type { Database } from '../../db/schema.js';
import { EngineUnavailableError } from '../../lib/errors.js';
import { BrowserTunnelEngineBackend } from './browser-tunnel-engine-backend.js';
import { CachingEngineBackend } from './caching-engine-backend.js';
import type { EngineBackend } from './engine-backend.js';
import type { EngineTunnelTransport } from './engine-tunnel-transport.js';
import { NativeEngineBackend } from './native-engine-backend.js';

export interface ResolveEngineBackendOptions {
  db: Kysely<Database>;
  engineUrl: string;
  tunnelTransport: EngineTunnelTransport;
  tunnelTimeoutMs: number;
}

/**
 * Reads the user's engineMode and returns the right EngineBackend, wrapped
 * in CachingEngineBackend so every caller gets caching uniformly. Replaces
 * bootstrap-time wiring — call this fresh per session/job/request rather
 * than once at process start (design spec §3).
 */
export async function resolveEngineBackend(options: ResolveEngineBackendOptions, userId: string): Promise<EngineBackend> {
  const user = await usersRepo.findById(options.db, userId);
  if (!user) throw new EngineUnavailableError(`Unknown user ${userId}`);

  const mode = user.engineMode;
  const raw: EngineBackend =
    mode === 'browser'
      ? new BrowserTunnelEngineBackend(options.tunnelTransport, userId, options.tunnelTimeoutMs)
      : new NativeEngineBackend(options.engineUrl);

  return new CachingEngineBackend(options.db, raw, { isExternalSource: mode === 'browser' });
}

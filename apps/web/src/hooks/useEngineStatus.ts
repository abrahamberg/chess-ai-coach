import { useEffect, useState } from 'react';
import { getSharedEngineWorker } from '../engine/shared-engine-worker-instance.js';
import type { EngineInstallStatus } from '../engine/shared-engine-worker.js';

export interface UseEngineStatusOptions {
  /** Start the download immediately rather than waiting for the first
   * analysis to need it. Use where the user has just opted into browser mode
   * and is therefore expecting the engine to arrive. */
  preload?: boolean;
}

/** Tracks the shared WASM engine's install state (see EngineInstallStatus) so the UI
 * can say whether it's downloading rather than leaving the user guessing. */
export function useEngineStatus(options: UseEngineStatusOptions = {}): EngineInstallStatus {
  const [status, setStatus] = useState<EngineInstallStatus>(() => getSharedEngineWorker().status);
  const preload = options.preload ?? false;

  useEffect(() => {
    const engine = getSharedEngineWorker();
    const unsubscribe = engine.subscribe(setStatus);
    if (preload) engine.preload();
    return unsubscribe;
  }, [preload]);

  return status;
}

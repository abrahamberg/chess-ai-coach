import { useEffect, useState } from 'react';
import { getSharedEngineWorker } from '../engine/shared-engine-worker-instance.js';
import type { EngineDownloadProgress, EngineInstallStatus } from '../engine/shared-engine-worker.js';

export interface UseEngineStatusOptions {
  /** Start the download immediately rather than waiting for the first
   * analysis to need it. Use where the user has just opted into browser mode
   * and is therefore expecting the engine to arrive. */
  preload?: boolean;
}

export interface UseEngineStatusResult {
  status: EngineInstallStatus;
  /** { percent, loaded, total } while status is 'installing' and the
   * worker build reports progress; null otherwise. */
  progress: EngineDownloadProgress | null;
}

/** Tracks the shared WASM engine's install state (see EngineInstallStatus) so the UI
 * can say whether it's downloading rather than leaving the user guessing. */
export function useEngineStatus(options: UseEngineStatusOptions = {}): UseEngineStatusResult {
  const [status, setStatus] = useState<EngineInstallStatus>(() => getSharedEngineWorker().status);
  const [progress, setProgress] = useState<EngineDownloadProgress | null>(() => getSharedEngineWorker().progress);
  const preload = options.preload ?? false;

  useEffect(() => {
    const engine = getSharedEngineWorker();
    const unsubscribeStatus = engine.subscribe(setStatus);
    const unsubscribeProgress = engine.subscribeProgress(setProgress);
    if (preload) engine.preload();
    return () => {
      unsubscribeStatus();
      unsubscribeProgress();
    };
  }, [preload]);

  return { status, progress };
}

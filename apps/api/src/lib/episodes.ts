export interface EpisodeScanResult<T> {
  messages: T[];
  previousPly: number | null;
}

/**
 * Coach context restructure design §1: an episode is the contiguous run of
 * messages at the end of an append-only, ply-tagged transcript sharing
 * `currentPly`. Scanned backward in memory (not a SQL GROUP BY) because the
 * boundary depends on transcript order, which SQL grouping doesn't
 * preserve. `previousPly` is the ply of the message immediately before the
 * episode started — null if the episode spans the whole transcript (e.g.
 * the session's very first episode).
 */
export function currentEpisode<T extends { ply: number | null }>(
  messages: T[],
  currentPly: number
): EpisodeScanResult<T> {
  let start = messages.length;
  while (start > 0 && messages[start - 1]?.ply === currentPly) {
    start--;
  }
  return {
    messages: messages.slice(start),
    previousPly: start > 0 ? (messages[start - 1]?.ply ?? null) : null
  };
}

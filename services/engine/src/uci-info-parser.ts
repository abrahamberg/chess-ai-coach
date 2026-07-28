export interface UciInfoLine {
  multipv: number;
  cp: number | null;
  mateIn: number | null;
  pvUci: string[];
}

/** Parses a single UCI `info ...` line into its score and principal variation.
 * Returns null for non-info lines, lines with no score/pv (e.g. `currmove`),
 * and bound-limited scores (`upperbound`/`lowerbound`) which aren't exact. */
export function parseInfoLine(line: string): UciInfoLine | null {
  if (!line.startsWith('info ')) return null;
  if (line.includes(' upperbound') || line.includes(' lowerbound')) return null;

  const scoreMatch = /\bscore (cp|mate) (-?\d+)/.exec(line);
  const pvMatch = /\bpv (.+)$/.exec(line);
  if (!scoreMatch || !pvMatch) return null;

  const kind = scoreMatch[1];
  const valueStr = scoreMatch[2];
  const pvText = pvMatch[1];
  if (!kind || !valueStr || !pvText) return null;

  const value = Number(valueStr);
  const multipvMatch = /\bmultipv (\d+)/.exec(line);
  const multipvStr = multipvMatch?.[1];

  return {
    multipv: multipvStr ? Number(multipvStr) : 1,
    cp: kind === 'cp' ? value : null,
    mateIn: kind === 'mate' ? value : null,
    pvUci: pvText.trim().split(/\s+/)
  };
}

/** Extracts the chosen move from a `bestmove ...` line, or null if the line isn't one. */
export function parseBestMove(line: string): string | null {
  const match = /^bestmove (\S+)/.exec(line);
  return match?.[1] ?? null;
}

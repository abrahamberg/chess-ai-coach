import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Locates a stockfish binary for tests: STOCKFISH_PATH env, then the apt-install
 * default (matches CI/docker), then whatever `which stockfish` finds locally. */
export function resolveTestStockfishPath(): string {
  if (process.env.STOCKFISH_PATH) return process.env.STOCKFISH_PATH;
  if (existsSync('/usr/games/stockfish')) return '/usr/games/stockfish';
  return execSync('which stockfish').toString().trim();
}

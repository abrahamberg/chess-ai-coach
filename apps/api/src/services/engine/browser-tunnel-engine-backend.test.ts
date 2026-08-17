import { describe, expect, test, vi } from 'vitest';
import { ENGINE_DEFAULT_DEPTH, ENGINE_TUNNEL_PER_POSITION_MS } from '@chess-coach/shared';
import type { EngineTunnelTransport } from './engine-tunnel-transport.js';
import { BrowserTunnelEngineBackend } from './browser-tunnel-engine-backend.js';

const VALID_ANALYSIS = {
  fen: 'f',
  depth: 15,
  multiPv: 3,
  bestMove: 'e4',
  eval: { cp: 20, mateIn: null },
  lines: [{ moveUci: 'e2e4', moveSan: 'e4', pvSan: ['e4'], cp: 20, mateIn: null }],
  features: {
    turn: 'white',
    boardState: 'none',
    availableMoves: [],
    mobility: { white: 0, black: 0 },
    controlledSquares: [],
    piecesUnderAttack: [],
    hangingPieces: [],
    underDefendedPieces: [],
    overloadedDefenders: [],
    centerControlScore: { white: 0, black: 0 },
    openFiles: [],
    semiOpenFiles: [],
    doubledPawns: [],
    isolatedPawns: [],
    passedPawns: [],
    targetsAttacked: [],
    forks: [],
    captureOpportunities: []
  }
};

function fakeTransport(result: unknown): EngineTunnelTransport & { request: ReturnType<typeof vi.fn> } {
  return { request: vi.fn().mockResolvedValue(result) };
}

describe('BrowserTunnelEngineBackend', () => {
  test('analyzePosition sends a correlated request with the default multiPv and returns the validated result', async () => {
    const transport = fakeTransport(VALID_ANALYSIS);
    const backend = new BrowserTunnelEngineBackend(transport, 'user-1', 8000);

    const result = await backend.analyzePosition('f');

    expect(transport.request).toHaveBeenCalledWith(
      'user-1',
      // Explicit depth, not undefined: left blank, the browser client falls
      // back to its own constant and can search shallower than the native
      // backend, mixing depths in the fen-keyed eval cache.
      { kind: 'analyze-position', fen: 'f', depth: ENGINE_DEFAULT_DEPTH, multiPv: 3 },
      // A single position can still be one of the slow ones — same
      // per-position allowance analyzeGame gets, just for one position.
      8000 + ENGINE_TUNNEL_PER_POSITION_MS
    );
    expect(result).toEqual(VALID_ANALYSIS);
  });

  test('analyzeGame sends a correlated request and returns the validated result array', async () => {
    const evals = [{ ply: 0, fen: 'f', depth: 14, lines: [{ moveUci: 'e2e4', moveSan: 'e4', cp: 20, mateIn: null }] }];
    const transport = fakeTransport(evals);
    const backend = new BrowserTunnelEngineBackend(transport, 'user-1', 8000);

    const result = await backend.analyzeGame(['f']);

    // Batch timeout scales with position count — a whole-game request can't be
    // held to the single-position budget.
    expect(transport.request).toHaveBeenCalledWith(
      'user-1',
      { kind: 'analyze-game', fens: ['f'], depth: ENGINE_DEFAULT_DEPTH, multiPv: 3 },
      8000 + ENGINE_TUNNEL_PER_POSITION_MS
    );
    expect(result).toEqual(evals);
  });

  test('propagates a transport rejection without catching it (fail-fast, no fallback)', async () => {
    const transport: EngineTunnelTransport = { request: vi.fn().mockRejectedValue(new Error('no tunnel')) };
    const backend = new BrowserTunnelEngineBackend(transport, 'user-1', 8000);

    await expect(backend.analyzePosition('f')).rejects.toThrow('no tunnel');
  });

  test('throws on a malformed tunnel response instead of trusting it', async () => {
    const transport = fakeTransport({ garbage: true });
    const backend = new BrowserTunnelEngineBackend(transport, 'user-1', 8000);

    await expect(backend.analyzePosition('f')).rejects.toThrow();
  });
});

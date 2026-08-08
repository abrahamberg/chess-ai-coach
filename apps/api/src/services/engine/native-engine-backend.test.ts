import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NativeEngineBackend } from './native-engine-backend.js';
import { ENGINE_MULTI_PV } from '../engine-client.js';

describe('NativeEngineBackend', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  const engineUrl = 'http://localhost:3001';

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should use default ENGINE_MULTI_PV when analyzing position without explicit multiPv', async () => {
    const mockAnalysis = {
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      depth: 20,
      multiPv: ENGINE_MULTI_PV,
      bestMove: 'e2e4',
      eval: { cp: 20, mateIn: null },
      lines: [
        {
          moveUci: 'e2e4',
          moveSan: 'e4',
          pvSan: ['e4'],
          cp: 20,
          mateIn: null
        }
      ],
      features: {
        turn: 'white',
        boardState: 'none',
        availableMoves: [],
        mobility: { white: 20, black: 20 },
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

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ analysis: mockAnalysis })
    });

    const backend = new NativeEngineBackend(engineUrl);
    const result = await backend.analyzePosition(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    );

    expect(mockFetch).toHaveBeenCalledWith(`${engineUrl}/analyze-position`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        multiPv: ENGINE_MULTI_PV
      })
    });

    expect(result).toEqual(mockAnalysis);
  });

  it('should use explicit multiPv when provided', async () => {
    const mockAnalysis = {
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      depth: 20,
      multiPv: 5,
      bestMove: 'e2e4',
      eval: { cp: 20, mateIn: null },
      lines: [
        {
          moveUci: 'e2e4',
          moveSan: 'e4',
          pvSan: ['e4'],
          cp: 20,
          mateIn: null
        }
      ],
      features: {
        turn: 'white',
        boardState: 'none',
        availableMoves: [],
        mobility: { white: 20, black: 20 },
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

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ analysis: mockAnalysis })
    });

    const backend = new NativeEngineBackend(engineUrl);
    const result = await backend.analyzePosition(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      { multiPv: 5 }
    );

    expect(mockFetch).toHaveBeenCalledWith(`${engineUrl}/analyze-position`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        multiPv: 5
      })
    });

    expect(result).toEqual(mockAnalysis);
  });

  it('should analyze game with multiple FENs', async () => {
    const mockEvals = [
      {
        ply: 0,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        depth: 20,
        lines: [
          {
            moveUci: 'e2e4',
            moveSan: 'e4',
            cp: 20,
            mateIn: null
          }
        ]
      },
      {
        ply: 1,
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        depth: 20,
        lines: [
          {
            moveUci: 'e7e5',
            moveSan: 'e5',
            cp: 25,
            mateIn: null
          }
        ]
      }
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ evals: mockEvals })
    });

    const backend = new NativeEngineBackend(engineUrl);
    const fens = [
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
    ];

    const result = await backend.analyzeGame(fens);

    expect(mockFetch).toHaveBeenCalledWith(`${engineUrl}/analyze-game`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fens })
    });

    expect(result).toEqual(mockEvals);
  });
});

import { describe, expect, test } from 'vitest';
import type { ClassifiedMove, FeatureDelta } from '@chess-coach/chess-analysis';
import type { PositionAnalysis, PositionAnalysisLine } from '@chess-coach/shared';
import {
  renderAnnotatedPgn,
  renderCurrentMoveBlock,
  renderGameSoFarInline,
  renderOtherMovesSummary,
  type CurrentMoveAnalysisContext
} from './episode-context.js';

function move(overrides: Partial<ClassifiedMove> & Pick<ClassifiedMove, 'ply' | 'moveSan' | 'quality'>): ClassifiedMove {
  return {
    mover: overrides.ply % 2 === 1 ? 'white' : 'black',
    isUserMove: true,
    cpLoss: 0,
    bestLineSan: [],
    evalAfterCp: 0,
    hangsPiece: false,
    ...overrides
  };
}

describe('renderAnnotatedPgn', () => {
  test('no moves renders a fallback under the heading', () => {
    expect(renderAnnotatedPgn([])).toBe('## This game (annotated)\n\n(no moves)');
  });

  test('sound moves (good/best) get only the quality symbol, no extra detail', () => {
    const moves = [
      move({ ply: 1, moveSan: 'e4', quality: 'best' }),
      move({ ply: 2, moveSan: 'e5', quality: 'good' })
    ];
    expect(renderAnnotatedPgn(moves)).toBe('## This game (annotated)\n\n1.e4★ e5!');
  });

  test('unsound moves (mistake/blunder/miss/dubious) get cpLoss and the best line inline', () => {
    // ply 17 = White's move 9 (odd ply); an odd ply is what carries the "N."
    // prefix — the fixture must use an odd ply for the "9." to appear at all.
    const moves = [move({ ply: 17, moveSan: 'Bg4', quality: 'mistake', cpLoss: 180, bestLineSan: ['h6', 'Bh4'] })];
    expect(renderAnnotatedPgn(moves)).toBe('## This game (annotated)\n\n9.Bg4? (lost ~180cp, best h6)');
  });
});

describe('renderGameSoFarInline (architecture §14, play mode\'s live layer-3 replacement)', () => {
  test('no moves renders a fallback, with no heading of its own (folded into the caller\'s block)', () => {
    expect(renderGameSoFarInline([])).toBe('(no moves played yet)');
  });

  test('renders identically to renderAnnotatedPgn\'s move formatting, just without its own heading', () => {
    const moves = [move({ ply: 1, moveSan: 'e4', quality: 'best' }), move({ ply: 2, moveSan: 'e5', quality: 'good' })];
    expect(renderGameSoFarInline(moves)).toBe('1.e4★ e5!');
    expect(renderAnnotatedPgn(moves)).toBe(`## This game (annotated)\n\n${renderGameSoFarInline(moves)}`);
  });

  test('accepts a game_move_qualities-shaped row too (no mover/isUserMove/hangsPiece fields required)', () => {
    const row = { ply: 1, moveSan: 'e4', quality: 'best' as const, cpLoss: 0, bestLineSan: [], evalAfterCp: 20 };
    expect(renderGameSoFarInline([row])).toBe('1.e4★');
  });
});

describe('renderOtherMovesSummary', () => {
  test('no notes renders a fallback under the heading', () => {
    expect(renderOtherMovesSummary([], [])).toBe(
      '## Other moves discussed\n\n(nothing discussed yet outside the current move)'
    );
  });

  test('one line per note, oldest first, with the quality tag when known', () => {
    const notes = [{ ply: 35, note: 'missed Rxd5, assigned as homework' }];
    const qualities = [{ ply: 35, quality: 'blunder' as const }];
    expect(renderOtherMovesSummary(notes, qualities)).toBe(
      "## Other moves discussed\n\n- White's move 18 (blunder): missed Rxd5, assigned as homework"
    );
  });

  test('a note with no matching classified move omits the quality tag', () => {
    const notes = [{ ply: 4, note: 'student asked about the opening name' }];
    expect(renderOtherMovesSummary(notes, [])).toBe(
      "## Other moves discussed\n\n- Black's move 2: student asked about the opening name"
    );
  });
});

describe('renderCurrentMoveBlock', () => {
  test('the first episode of a session has no played-move sentence', () => {
    const text = renderCurrentMoveBlock(0, 'startpos-fen', 'white', '(empty — no parked topics right now)', null);
    expect(text).toContain('You are now discussing the game start');
    expect(text).not.toContain('The move actually played here was');
  });

  test('states the current fen and the student\'s color', () => {
    const text = renderCurrentMoveBlock(35, 'fen-after-18', 'black', '(empty — no parked topics right now)', 'Nc3');
    expect(text).toContain("You are now discussing White's move 18");
    expect(text).toContain('Your student is playing black in this game.');
    expect(text).toContain(': fen-after-18');
  });

  test('folds the thread ledger in under its own heading (final review #8: heading owned by packages/prompts)', () => {
    const text = renderCurrentMoveBlock(0, 'startpos-fen', 'white', '- [active] the h3 line', null);
    expect(text).toContain('## Your thread ledger\n\n- [active] the h3 line');
  });

  test('names the move actually played, with no arrow/board framing', () => {
    const text = renderCurrentMoveBlock(27, 'current-fen', 'white', '(empty — no parked topics right now)', 'Bxd5');
    expect(text).toContain('The move actually played here was Bxd5.');
    expect(text).not.toContain('red arrow');
    expect(text).toContain(': current-fen');
  });

  test('gameSoFar omitted (analyze mode, the default): no "## Game so far" heading appears — output is byte-for-byte what it always was', () => {
    const withoutArg = renderCurrentMoveBlock(0, 'startpos-fen', 'white', '(empty — no parked topics right now)', null);
    const explicitUndefined = renderCurrentMoveBlock(
      0,
      'startpos-fen',
      'white',
      '(empty — no parked topics right now)',
      null,
      undefined,
      undefined
    );
    expect(withoutArg).not.toContain('## Game so far');
    expect(withoutArg).toBe(explicitUndefined);
  });

  test('gameSoFar present (play mode): prepends a "## Game so far" block ahead of "## Current position"', () => {
    const text = renderCurrentMoveBlock(
      2,
      'fen',
      'white',
      '(empty — no parked topics right now)',
      'e5',
      undefined,
      '1.e4★ e5!'
    );
    expect(text).toContain('## Game so far\n\n1.e4★ e5!\n\n');
    expect(text.indexOf('## Game so far')).toBeLessThan(text.indexOf('## Current position'));
  });

  test('ply 0 (game start) never has a played-move sentence — nothing was played to reach it', () => {
    const text = renderCurrentMoveBlock(0, 'startpos-fen', 'white', '(empty — no parked topics right now)', null);
    expect(text).not.toContain('The move actually played here was');
  });

  test('omits the curated analysis section when no analysisContext is given', () => {
    const text = renderCurrentMoveBlock(2, 'fen', 'white', '(empty — no parked topics right now)', 'e5');
    expect(text).not.toContain('Best line');
    expect(text).not.toContain('Other engine options');
    expect(text).not.toContain('engine’s top choice');
  });

  function line(overrides: Partial<PositionAnalysisLine> & Pick<PositionAnalysisLine, 'moveSan' | 'pvSan'>): PositionAnalysisLine {
    return { moveUci: '', cp: 0, mateIn: null, ...overrides };
  }

  function analysis(overrides: Partial<PositionAnalysis> & Pick<PositionAnalysis, 'bestMove' | 'lines'>): PositionAnalysis {
    return {
      fen: 'fen',
      depth: 16,
      multiPv: overrides.lines.length,
      eval: { cp: overrides.lines[0]?.cp ?? null, mateIn: overrides.lines[0]?.mateIn ?? null },
      features: { forks: [], hangingPieces: [], availableMoves: [] } as unknown as PositionAnalysis['features'],
      ...overrides
    };
  }

  test('shows the best/played lines and their eval delta when the student did not play the best move', () => {
    const ctx: CurrentMoveAnalysisContext = {
      analysis: analysis({
        bestMove: 'd6',
        lines: [
          line({ moveSan: 'd6', pvSan: ['d6', 'O-O', 'a6'], cp: 17 }),
          line({ moveSan: 'Ba3', pvSan: ['Ba3', 'a6', 'O-O'], cp: 14 })
        ]
      }),
      classifiedMove: { cpLoss: 163, evalAfterCp: 6 }
    };
    // ply 16 = Black's move 8 (plyToMoveRef: moveNumber = ceil(ply/2)).
    const text = renderCurrentMoveBlock(16, 'pre-move-fen', 'white', '(empty — no parked topics right now)', 'd5', ctx);

    expect(text).toContain("Played d5 (eval +0.06, cost ~163cp) instead of the engine's best, d6 (eval +0.17).");
    expect(text).toContain('Best line: 8...d6 9.O-O a6');
    expect(text).toContain('Played line: 8...d5');
    expect(text).toContain('Other engine options:\n- Ba3 (eval +0.14): 8...Ba3 9.a6 O-O');
  });

  test('extends the played line with the post-move continuation when provided', () => {
    const ctx: CurrentMoveAnalysisContext = {
      analysis: analysis({ bestMove: 'd6', lines: [line({ moveSan: 'd6', pvSan: ['d6'], cp: 17 })] }),
      postMoveAnalysis: analysis({ bestMove: 'exd5', lines: [line({ moveSan: 'exd5', pvSan: ['exd5', 'Nxd5'], cp: 6 })] })
    };
    const text = renderCurrentMoveBlock(16, 'pre-move-fen', 'white', '(empty — no parked topics right now)', 'd5', ctx);

    expect(text).toContain('Played line: 8...d5 9.exd5 Nxd5');
  });

  test('truncates a PV line to 6 full moves', () => {
    const longPv = ['d6', 'O-O', 'a6', 'Bb3', 'Ba7', 'h3', 'h6', 'c3', 'O-O', 'Re1', 'd6', 'a4', 'Nb6', 'a5'];
    const ctx: CurrentMoveAnalysisContext = {
      analysis: analysis({ bestMove: 'd6', lines: [line({ moveSan: 'd6', pvSan: longPv, cp: 17 })] })
    };
    const text = renderCurrentMoveBlock(16, 'pre-move-fen', 'white', '(empty — no parked topics right now)', 'd5', ctx);

    expect(text).toContain('Best line: 8...d6 9.O-O a6 10.Bb3 Ba7 11.h3 h6 12.c3 O-O 13.Re1 d6 14.a4');
    expect(text).not.toContain('Nb6');
    expect(text).not.toContain('a5');
  });

  test('collapses to a single sentence when the student played the engine\'s top choice', () => {
    const ctx: CurrentMoveAnalysisContext = {
      analysis: analysis({ bestMove: 'e5', lines: [line({ moveSan: 'e5', pvSan: ['e5', 'Nf3'], cp: 20 })] })
    };
    const text = renderCurrentMoveBlock(2, 'fen', 'white', '(empty — no parked topics right now)', 'e5', ctx);

    expect(text).toContain('This was the engine’s top choice.');
    expect(text).toContain('Line: 1...e5 2.Nf3');
    expect(text).not.toContain('instead of');
    expect(text).not.toContain('Played line');
  });

  test('shows just the engine\'s top choice with no played/delta section when no move has been played yet (ply 0)', () => {
    const ctx: CurrentMoveAnalysisContext = {
      analysis: analysis({ bestMove: 'e4', lines: [line({ moveSan: 'e4', pvSan: ['e4', 'e5'], cp: 25 })] })
    };
    const text = renderCurrentMoveBlock(0, 'startpos-fen', 'white', '(empty — no parked topics right now)', null, ctx);

    expect(text).toContain("Engine's top choice here: e4 (eval +0.25)");
    expect(text).toContain('Line: 1.e4 e5');
    expect(text).not.toContain('instead of');
    expect(text).not.toContain('Played line');
  });

  test('renders the feature-delta bullets when provided, omitting the section when the delta is empty', () => {
    const baseCtx: CurrentMoveAnalysisContext = {
      analysis: analysis({ bestMove: 'd6', lines: [line({ moveSan: 'd6', pvSan: ['d6'], cp: 17 })] })
    };
    const delta: FeatureDelta = {
      newForks: [{ square: 'd5', piece: 'n', forkedSquares: ['c7', 'e7'] }],
      newHangingPieces: [],
      mobilityDelta: -3
    };
    const withDelta = renderCurrentMoveBlock(8, 'fen', 'white', '(empty — no parked topics right now)', 'd5', {
      ...baseCtx,
      featureDelta: delta
    });
    expect(withDelta).toContain('What changed vs. the best move:');
    expect(withDelta).toContain('- New fork: n on d5 forks c7/e7');
    expect(withDelta).toContain('- 3 fewer legal replies available');

    const withEmptyDelta = renderCurrentMoveBlock(8, 'fen', 'white', '(empty — no parked topics right now)', 'd5', {
      ...baseCtx,
      featureDelta: { newForks: [], newHangingPieces: [], mobilityDelta: 0 }
    });
    expect(withEmptyDelta).not.toContain('What changed vs. the best move');
  });

  test('omits classified-move-dependent cost clause when no classified move is available yet', () => {
    const ctx: CurrentMoveAnalysisContext = {
      analysis: analysis({ bestMove: 'd6', lines: [line({ moveSan: 'd6', pvSan: ['d6'], cp: 17 })] })
    };
    const text = renderCurrentMoveBlock(8, 'fen', 'white', '(empty — no parked topics right now)', 'd5', ctx);

    expect(text).toContain("Played d5 instead of the engine's best, d6 (eval +0.17).");
    expect(text).not.toContain('cost ~');
  });
});

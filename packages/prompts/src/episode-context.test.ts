import { describe, expect, test } from 'vitest';
import type { ClassifiedMove, FeatureDelta } from '@chess-coach/chess-analysis';
import type { PositionAnalysis, PositionAnalysisLine } from '@chess-coach/shared';
import { renderAnnotatedPgn, renderCurrentMoveBlock, renderOtherMovesSummary, type CurrentMoveAnalysisContext } from './episode-context.js';

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
  test('the first episode of a session has no "reached from" sentence', () => {
    const text = renderCurrentMoveBlock(0, 'startpos-fen', null, '(empty — no parked topics right now)', null);
    expect(text).toContain('You are now discussing the game start');
    expect(text).not.toContain('You reached this position from');
    expect(text).not.toContain('The move actually played here was');
  });

  test('a jump includes where the coach/student arrived from', () => {
    const text = renderCurrentMoveBlock(35, 'fen-after-18', 8, '(empty — no parked topics right now)', 'Nc3');
    expect(text).toContain("You are now discussing White's move 18");
    expect(text).toContain('FEN: fen-after-18');
    expect(text).toContain("You reached this position from Black's move 4");
  });

  test('folds the thread ledger in under its own heading (final review #8: heading owned by packages/prompts)', () => {
    const text = renderCurrentMoveBlock(0, 'startpos-fen', null, '- [active] the h3 line', null);
    expect(text).toContain('## Your thread ledger\n\n- [active] the h3 line');
  });

  test('names the move actually played — the board now shows the pre-move position, so this states the outcome in words', () => {
    const text = renderCurrentMoveBlock(27, 'pre-move-fen', null, '(empty — no parked topics right now)', 'Bxd5');
    expect(text).toContain('The move actually played here was Bxd5 — shown as a red arrow on the board.');
    expect(text).toContain('FEN: pre-move-fen');
  });

  test('ply 0 (game start) never has a played-move sentence — nothing was played to reach it', () => {
    const text = renderCurrentMoveBlock(0, 'startpos-fen', null, '(empty — no parked topics right now)', null);
    expect(text).not.toContain('The move actually played here was');
  });

  test('omits the curated analysis section by default (showEngineAnalysis off)', () => {
    const text = renderCurrentMoveBlock(2, 'fen', null, '(empty — no parked topics right now)', 'e5');
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
      features: {} as PositionAnalysis['features'],
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
      classifiedMove: { ply: 16, moveSan: 'd5', mover: 'black', isUserMove: true, cpLoss: 163, quality: 'mistake', bestLineSan: ['d6'], evalAfterCp: 6, hangsPiece: false }
    };
    // ply 16 = Black's move 8 (plyToMoveRef: moveNumber = ceil(ply/2)).
    const text = renderCurrentMoveBlock(16, 'pre-move-fen', null, '(empty — no parked topics right now)', 'd5', ctx);

    expect(text).toContain("Played d5 (eval +0.06, cost ~163cp) instead of the engine's best, d6 (eval +0.17).");
    expect(text).toContain('Best line: 8...d6 9.O-O a6 (2 full moves)');
    expect(text).toContain('Played line: 8...d5 (1 full move)');
    expect(text).toContain('Other engine options:\n- Ba3 (eval +0.14): 8...Ba3 9.a6 O-O (2 full moves)');
  });

  test('extends the played line with the post-move continuation when provided', () => {
    const ctx: CurrentMoveAnalysisContext = {
      analysis: analysis({ bestMove: 'd6', lines: [line({ moveSan: 'd6', pvSan: ['d6'], cp: 17 })] }),
      postMoveAnalysis: analysis({ bestMove: 'exd5', lines: [line({ moveSan: 'exd5', pvSan: ['exd5', 'Nxd5'], cp: 6 })] })
    };
    const text = renderCurrentMoveBlock(16, 'pre-move-fen', null, '(empty — no parked topics right now)', 'd5', ctx);

    expect(text).toContain('Played line: 8...d5 9.exd5 Nxd5 (2 full moves)');
  });

  test('collapses to a single sentence when the student played the engine\'s top choice', () => {
    const ctx: CurrentMoveAnalysisContext = {
      analysis: analysis({ bestMove: 'e5', lines: [line({ moveSan: 'e5', pvSan: ['e5', 'Nf3'], cp: 20 })] })
    };
    const text = renderCurrentMoveBlock(2, 'fen', null, '(empty — no parked topics right now)', 'e5', ctx);

    expect(text).toContain('This was the engine’s top choice.');
    expect(text).toContain('Line: 1...e5 2.Nf3 (2 full moves)');
    expect(text).not.toContain('instead of');
    expect(text).not.toContain('Played line');
  });

  test('shows just the engine\'s top choice with no played/delta section when no move has been played yet (ply 0)', () => {
    const ctx: CurrentMoveAnalysisContext = {
      analysis: analysis({ bestMove: 'e4', lines: [line({ moveSan: 'e4', pvSan: ['e4', 'e5'], cp: 25 })] })
    };
    const text = renderCurrentMoveBlock(0, 'startpos-fen', null, '(empty — no parked topics right now)', null, ctx);

    expect(text).toContain("Engine's top choice here: e4 (eval +0.25)");
    expect(text).toContain('Line: 1.e4 e5 (1 full move)');
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
    const withDelta = renderCurrentMoveBlock(8, 'fen', null, '(empty — no parked topics right now)', 'd5', {
      ...baseCtx,
      featureDelta: delta
    });
    expect(withDelta).toContain('What changed vs. the best move:');
    expect(withDelta).toContain('- New fork: n on d5 forks c7/e7');
    expect(withDelta).toContain('- 3 fewer legal replies available');

    const withEmptyDelta = renderCurrentMoveBlock(8, 'fen', null, '(empty — no parked topics right now)', 'd5', {
      ...baseCtx,
      featureDelta: { newForks: [], newHangingPieces: [], mobilityDelta: 0 }
    });
    expect(withEmptyDelta).not.toContain('What changed vs. the best move');
  });

  test('omits classified-move-dependent cost clause when no classified move is available yet', () => {
    const ctx: CurrentMoveAnalysisContext = {
      analysis: analysis({ bestMove: 'd6', lines: [line({ moveSan: 'd6', pvSan: ['d6'], cp: 17 })] })
    };
    const text = renderCurrentMoveBlock(8, 'fen', null, '(empty — no parked topics right now)', 'd5', ctx);

    expect(text).toContain("Played d5 instead of the engine's best, d6 (eval +0.17).");
    expect(text).not.toContain('cost ~');
  });
});

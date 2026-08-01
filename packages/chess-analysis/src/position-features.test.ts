import { describe, expect, test } from 'vitest';
import { computePositionFeatures } from './position-features.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('boardState', () => {
  test('none for a quiet position', () => {
    expect(computePositionFeatures(START_FEN).boardState).toBe('none');
  });
  test('check when the side to move is in check but not mated', () => {
    const fen = '4k3/8/8/8/4R3/8/8/4K3 b - - 0 1';
    expect(computePositionFeatures(fen).boardState).toBe('check');
  });
  test('checkmate on fool\'s mate', () => {
    const fen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    expect(computePositionFeatures(fen).boardState).toBe('checkmate');
  });
  test('stalemate on the classic king+queen stalemate', () => {
    const fen = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
    expect(computePositionFeatures(fen).boardState).toBe('stalemate');
  });
});

test('turn reflects the FEN active color', () => {
  expect(computePositionFeatures(START_FEN).turn).toBe('white');
  expect(computePositionFeatures('4k3/8/8/8/8/8/8/4K3 b - - 0 1').turn).toBe('black');
});

test('mobility is symmetric for the symmetric starting position', () => {
  const { mobility } = computePositionFeatures(START_FEN);
  expect(mobility.white).toBe(mobility.black);
  expect(mobility.white).toBeGreaterThan(0);
});

test('availableMoves matches chess.js legal moves for the side to move', () => {
  const { availableMoves } = computePositionFeatures(START_FEN);
  expect(availableMoves).toHaveLength(20);
  expect(availableMoves).toContain('e4');
});

test('controlledSquares includes each knight\'s starting attacks', () => {
  const { controlledSquares } = computePositionFeatures(START_FEN);
  const b1 = controlledSquares.find((entry) => entry.square === 'b1');
  expect(b1?.piece).toBe('n');
  expect(b1?.squares).toEqual(expect.arrayContaining(['a3', 'c3']));
});

describe('attacked-piece features (hanging / under-defended)', () => {
  // White queen d1, undefended (king is on h1, out of range); black rook d8
  // attacks it down the open d-file.
  const HANGING_QUEEN_FEN = '3rk3/8/8/8/8/8/8/3Q3K w - - 0 1';
  // White knight d4, attacked by two black rooks (d8 file, a4 rank) and
  // defended by exactly one white pawn (c3) — attackers(2) > defenders(1).
  const UNDERDEFENDED_KNIGHT_FEN = '3rk3/8/8/8/r2N4/2P5/8/7K w - - 0 1';

  test('a fully undefended attacked piece is both underAttack and hanging', () => {
    const features = computePositionFeatures(HANGING_QUEEN_FEN);
    // The rook on d8 is also "under attack" (the queen attacks straight back
    // down the same open file) and defended by the king on e8 — both pieces
    // legitimately show up here, only the queen is hanging.
    expect(features.piecesUnderAttack).toEqual(
      expect.arrayContaining([{ square: 'd1', piece: 'q', color: 'white', attackers: 1, defenders: 0 }])
    );
    expect(features.hangingPieces).toEqual([{ square: 'd1', piece: 'q', color: 'white', attackers: 1, defenders: 0 }]);
    expect(features.underDefendedPieces).toEqual([]);
  });

  test('an attacked piece with fewer defenders than attackers is under-defended, not hanging', () => {
    const features = computePositionFeatures(UNDERDEFENDED_KNIGHT_FEN);
    expect(features.underDefendedPieces).toEqual([
      { square: 'd4', piece: 'n', color: 'white', attackers: 2, defenders: 1 }
    ]);
    expect(features.hangingPieces).toEqual([]);
  });
});

test('overloadedDefenders finds a piece that is the sole defender of two attacked pieces', () => {
  // White knight e3 is the only defender of both Pc4 (attacked by Ra4) and
  // Pg4 (attacked by Rg8).
  const fen = '4k1r1/8/8/8/r1P3P1/4N3/8/7K w - - 0 1';
  const { overloadedDefenders } = computePositionFeatures(fen);
  expect(overloadedDefenders).toHaveLength(1);
  expect(overloadedDefenders[0]?.square).toBe('e3');
  expect(overloadedDefenders[0]?.defending).toEqual(expect.arrayContaining(['c4', 'g4']));
});

test('centerControlScore is zero for both sides in the starting position', () => {
  expect(computePositionFeatures(START_FEN).centerControlScore).toEqual({ white: 0, black: 0 });
});

describe('pawn structure', () => {
  test('open and semi-open files', () => {
    // c- and e-files have no pawns at all (open); d-file has a black pawn
    // only, so it's semi-open for White.
    const fen = '4k3/pp1p1ppp/8/8/8/8/PP3PPP/4K3 w - - 0 1';
    const { openFiles, semiOpenFiles } = computePositionFeatures(fen);
    expect(openFiles).toEqual(expect.arrayContaining(['c', 'e']));
    expect(semiOpenFiles).toEqual(expect.arrayContaining([{ file: 'd', openFor: 'white' }]));
  });

  test('doubled and isolated pawns on an isolated e-file pair', () => {
    const fen = '4k3/8/8/8/4P3/8/4P3/4K3 w - - 0 1';
    const { doubledPawns, isolatedPawns } = computePositionFeatures(fen);
    expect(doubledPawns).toEqual([{ file: 'e', color: 'white', count: 2 }]);
    expect(isolatedPawns).toEqual(
      expect.arrayContaining([
        { square: 'e4', color: 'white' },
        { square: 'e2', color: 'white' }
      ])
    );
  });

  test('a pawn blocked by an adjacent-file enemy pawn ahead of it is not passed', () => {
    const fen = '4k3/8/3p4/4P3/8/8/8/4K3 w - - 0 1';
    const { passedPawns } = computePositionFeatures(fen);
    expect(passedPawns).not.toEqual(expect.arrayContaining([{ square: 'e5', color: 'white' }]));
  });

  test('a pawn with no enemy pawns ahead on its own or adjacent files is passed', () => {
    const fen = '4k3/8/8/4P3/8/3p4/8/4K3 w - - 0 1';
    const { passedPawns } = computePositionFeatures(fen);
    expect(passedPawns).toEqual(expect.arrayContaining([{ square: 'e5', color: 'white' }]));
  });
});

test('targetsAttacked lists the square the side to move actually attacks an enemy piece on', () => {
  const fen = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
  const { targetsAttacked } = computePositionFeatures(fen);
  expect(targetsAttacked).toEqual(expect.arrayContaining([{ from: 'e4', piece: 'p', targets: ['d5'] }]));
});

test('forks flags a knight attacking two undefended, more-valuable pieces at once', () => {
  const fen = '4k3/8/1r3n2/3N4/8/8/8/7K w - - 0 1';
  const { forks } = computePositionFeatures(fen);
  expect(forks).toHaveLength(1);
  expect(forks[0]).toMatchObject({ square: 'd5', piece: 'n' });
  expect(forks[0]?.forkedSquares).toEqual(expect.arrayContaining(['b6', 'f6']));
});

describe('captureOpportunities', () => {
  test('an equal, undefended trade is favorable', () => {
    const fen = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
    const { captureOpportunities } = computePositionFeatures(fen);
    expect(captureOpportunities).toEqual(
      expect.arrayContaining([{ moveSan: 'exd5', from: 'e4', to: 'd5', capturedPiece: 'p', favorable: true }])
    );
  });

  test('a knight capturing a doubly-defended pawn is unfavorable', () => {
    const fen = '4k3/8/2p1p3/3p4/8/2N5/8/7K w - - 0 1';
    const { captureOpportunities } = computePositionFeatures(fen);
    expect(captureOpportunities).toEqual(
      expect.arrayContaining([{ moveSan: 'Nxd5', from: 'c3', to: 'd5', capturedPiece: 'p', favorable: false }])
    );
  });
});

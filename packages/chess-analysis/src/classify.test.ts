import type { EngineEval } from '@chess-coach/shared';
import { describe, expect, test } from 'vitest';
import type { ParsedGame } from './pgn.js';
import { classifyMoves } from './classify.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E4_E5_FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

/**
 * A minimal two-ply ParsedGame (one white move, one black move) purely for
 * feeding hand-built eval fixtures through classifyMoves — the actual
 * moves/FENs are irrelevant to classification, only the ply/mover shape is.
 */
function twoPlyGame(): ParsedGame {
  return {
    headers: { White: 'Alice', Black: 'Bob' },
    positions: [
      { ply: 0, fen: START_FEN, moveSan: null, moveUci: null, mover: null },
      { ply: 1, fen: AFTER_E4_FEN, moveSan: 'e4', moveUci: 'e2e4', mover: 'white' },
      { ply: 2, fen: AFTER_E4_E5_FEN, moveSan: 'e5', moveUci: 'e7e5', mover: 'black' }
    ]
  };
}

function evalAt(fen: string, cp: number | null, mateIn: number | null = null): EngineEval {
  return {
    ply: 0,
    fen,
    depth: 18,
    lines: [{ moveUci: 'e2e4', moveSan: 'e4', cp, mateIn }]
  };
}

describe('classifyMoves', () => {
  test('cpLoss 0 (played the engine-best move) classifies as best', () => {
    const game = twoPlyGame();
    const evals = [evalAt(START_FEN, 30), evalAt(AFTER_E4_FEN, 30), evalAt(AFTER_E4_E5_FEN, 30)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(0);
    expect(whiteMove?.quality).toBe('best');
  });

  test('cpLoss 75 classifies as dubious', () => {
    const game = twoPlyGame();
    // White to move at ply 0: best = +100 (white perspective). White plays a
    // move leaving the position at ply 1 with best = +25 (still white
    // perspective, mover is white so no sign flip). 100 - 25 = 75.
    const evals = [evalAt(START_FEN, 100), evalAt(AFTER_E4_FEN, 25), evalAt(AFTER_E4_E5_FEN, 25)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(75);
    expect(whiteMove?.quality).toBe('dubious');
  });

  test('cpLoss 30 (below dubious, above the near-best band) classifies as interesting', () => {
    const game = twoPlyGame();
    const evals = [evalAt(START_FEN, 100), evalAt(AFTER_E4_FEN, 70), evalAt(AFTER_E4_E5_FEN, 70)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(30);
    expect(whiteMove?.quality).toBe('interesting');
  });

  test('a non-capture move onto a square defended by a black pawn, with low cpLoss, classifies as brilliant', () => {
    // White bishop c4-e6 (non-capture): e6 is defended by both black pawns
    // d7 and f7. The engine still rates it best (cpLoss 0) — a genuine
    // "offer" the opponent could refuse to take, which is what makes it
    // worth flagging rather than an ordinary trade.
    const beforeFen = '4k3/3p1p2/8/8/2B5/8/8/4K3 w - - 0 1';
    const afterFen = '4k3/3p1p2/4B3/8/8/8/8/4K3 b - - 1 1';
    const game: ParsedGame = {
      headers: {},
      positions: [
        { ply: 0, fen: beforeFen, moveSan: null, moveUci: null, mover: null },
        { ply: 1, fen: afterFen, moveSan: 'Be6', moveUci: 'c4e6', mover: 'white' }
      ]
    };
    const evals = [evalAt(beforeFen, 0), evalAt(afterFen, 0)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(0);
    expect(whiteMove?.quality).toBe('brilliant');
  });

  test('the same non-capture move onto an undefended square stays best, not brilliant', () => {
    const beforeFen = '4k3/8/8/8/2B5/8/8/4K3 w - - 0 1';
    const afterFen = '4k3/8/4B3/8/8/8/8/4K3 b - - 1 1';
    const game: ParsedGame = {
      headers: {},
      positions: [
        { ply: 0, fen: beforeFen, moveSan: null, moveUci: null, mover: null },
        { ply: 1, fen: afterFen, moveSan: 'Be6', moveUci: 'c4e6', mover: 'white' }
      ]
    };
    const evals = [evalAt(beforeFen, 0), evalAt(afterFen, 0)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.quality).toBe('best');
  });

  test('a capture is never classified as brilliant, even onto a defended square with low cpLoss', () => {
    // Bxd7: bishop captures a black pawn on d7, landing on a square also
    // defended by the black king — but this is an ordinary trade (a
    // capture), not a material "offer", so the sacrifice heuristic excludes
    // it deliberately.
    const beforeFen = '4k3/3p4/8/8/2B5/8/8/4K3 w - - 0 1';
    const afterFen = '4k3/3B4/8/8/8/8/8/4K3 b - - 0 1';
    const game: ParsedGame = {
      headers: {},
      positions: [
        { ply: 0, fen: beforeFen, moveSan: null, moveUci: null, mover: null },
        { ply: 1, fen: afterFen, moveSan: 'Bxd7', moveUci: 'c4d7', mover: 'white' }
      ]
    };
    const evals = [evalAt(beforeFen, 0), evalAt(afterFen, 0)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.quality).toBe('best');
  });

  test('cpLoss 150 classifies as mistake', () => {
    const game = twoPlyGame();
    const evals = [
      evalAt(START_FEN, 100),
      evalAt(AFTER_E4_FEN, -50),
      evalAt(AFTER_E4_E5_FEN, -50)
    ];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(150);
    expect(whiteMove?.quality).toBe('mistake');
  });

  test('cpLoss 400 classifies as blunder', () => {
    const game = twoPlyGame();
    const evals = [
      evalAt(START_FEN, 100),
      evalAt(AFTER_E4_FEN, -300),
      evalAt(AFTER_E4_E5_FEN, -300)
    ];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(400);
    expect(whiteMove?.quality).toBe('blunder');
  });

  test('clamps cpLoss at 1000 even when the raw gap is larger', () => {
    const game = twoPlyGame();
    const evals = [
      evalAt(START_FEN, 900),
      evalAt(AFTER_E4_FEN, -900),
      evalAt(AFTER_E4_E5_FEN, -900)
    ];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(1000);
    expect(whiteMove?.quality).toBe('blunder');
  });

  test('missing an available mate maps the miss to 1000 cpLoss', () => {
    const game = twoPlyGame();
    // White had mate-in-3 available (mateIn: 3 -> +1000cp, white perspective,
    // mover is white so no flip) but instead played a move leaving a roughly
    // equal position (0 cp) at ply 1.
    const evals = [
      evalAt(START_FEN, null, 3),
      evalAt(AFTER_E4_FEN, 0, null),
      evalAt(AFTER_E4_E5_FEN, 0, null)
    ];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(1000);
    expect(whiteMove?.quality).toBe('blunder');
  });

  test('black-to-move perspective flip: black finds the objectively-best move, no cp loss', () => {
    const game = twoPlyGame();
    // Black's move goes from position 1 (white-perspective best +100, i.e.
    // black-perspective best -100) to position 2 (white-perspective best
    // +100 again, i.e. black-perspective best -100 still). Black made no
    // progress but also lost nothing relative to the best available result.
    const evals = [
      evalAt(START_FEN, 0),
      evalAt(AFTER_E4_FEN, 100),
      evalAt(AFTER_E4_E5_FEN, 100)
    ];

    const blackMove = classifyMoves(game, evals, 'black').find((move) => move.ply === 2);

    expect(blackMove?.cpLoss).toBe(0);
    expect(blackMove?.quality).toBe('best');
  });

  test('black-to-move perspective flip: naive unflipped subtraction would give the wrong sign', () => {
    const game = twoPlyGame();
    // Before black's move (ply 1): white-perspective best = +200, i.e. this
    // is GOOD for White / BAD for Black (black-perspective best = -200).
    // After black's move (ply 2): white-perspective best = 0, i.e. neutral
    // for Black too (black-perspective best = 0). In black's own
    // perspective black improved from -200 to 0, so cpLoss = clamp(-200 - 0)
    // clamped at the 0 floor = 0: black played a fully equalizing move.
    //
    // A buggy implementation that forgot to flip sign for the black mover
    // would instead read the raw white-perspective numbers directly
    // (bestCp=200, playedCp=0) and compute cpLoss=200 -> `mistake`, which is
    // the wrong classification for what is actually a great move.
    const evals = [
      evalAt(START_FEN, 0),
      evalAt(AFTER_E4_FEN, 200),
      evalAt(AFTER_E4_E5_FEN, 0)
    ];

    const blackMove = classifyMoves(game, evals, 'black').find((move) => move.ply === 2);

    expect(blackMove?.cpLoss).toBe(0);
    expect(blackMove?.quality).toBe('best');
  });

  test('cpLoss 5 (near best but not exact) stays good, not best', () => {
    const game = twoPlyGame();
    const evals = [evalAt(START_FEN, 100), evalAt(AFTER_E4_FEN, 95), evalAt(AFTER_E4_E5_FEN, 95)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(5);
    expect(whiteMove?.quality).toBe('good');
  });

  test('isUserMove is true only for moves made by the given userColor', () => {
    const game = twoPlyGame();
    const evals = [evalAt(START_FEN, 20), evalAt(AFTER_E4_FEN, 20), evalAt(AFTER_E4_E5_FEN, 20)];

    const moves = classifyMoves(game, evals, 'white');

    expect(moves).toHaveLength(2);
    const whiteMove = moves.find((move) => move.mover === 'white');
    const blackMove = moves.find((move) => move.mover === 'black');
    expect(whiteMove?.isUserMove).toBe(true);
    expect(blackMove?.isUserMove).toBe(false);
  });

  test('classifies moves for both colors even when userColor is black', () => {
    const game = twoPlyGame();
    const evals = [evalAt(START_FEN, 20), evalAt(AFTER_E4_FEN, 20), evalAt(AFTER_E4_E5_FEN, 20)];

    const moves = classifyMoves(game, evals, 'black');

    expect(moves).toHaveLength(2);
    const whiteMove = moves.find((move) => move.mover === 'white');
    const blackMove = moves.find((move) => move.mover === 'black');
    expect(whiteMove?.isUserMove).toBe(false);
    expect(blackMove?.isUserMove).toBe(true);
  });

  test('produces ply, moveSan, mover, bestLineSan and evalAfterCp for each move', () => {
    const game = twoPlyGame();
    const evals = [evalAt(START_FEN, 30), evalAt(AFTER_E4_FEN, 25), evalAt(AFTER_E4_E5_FEN, 25)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.ply).toBe(1);
    expect(whiteMove?.moveSan).toBe('e4');
    expect(whiteMove?.mover).toBe('white');
    expect(whiteMove?.bestLineSan).toEqual(['e4']);
    expect(whiteMove?.evalAfterCp).toBe(25);
  });

  test('evalAfterCp maps a mate score for the position after the move to +-1000, white perspective', () => {
    const game = twoPlyGame();
    // After White's move (ply 1), White has mate-in-2 -> white-perspective
    // +1000 regardless of whose move classification we're looking at.
    const evals = [
      evalAt(START_FEN, 0),
      evalAt(AFTER_E4_FEN, null, 2),
      evalAt(AFTER_E4_E5_FEN, 0)
    ];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.evalAfterCp).toBe(1000);
  });

  test('delivering checkmate is always cpLoss 0, even though the engine has no lines for the resulting no-legal-moves position', () => {
    // The engine can't search a position with no legal moves, so evals for a
    // checkmating move's "after" position come back with an empty lines
    // array — whitePerspectiveCp(undefined) falls back to 0, which would
    // otherwise make the winning move look like it "lost" the mate-in-1
    // advantage (cpLoss 1000, 'blunder') instead of being the best move.
    const beforeMateFen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const afterMateFen = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';
    const game: ParsedGame = {
      headers: {},
      positions: [
        { ply: 0, fen: beforeMateFen, moveSan: null, moveUci: null, mover: null },
        { ply: 1, fen: afterMateFen, moveSan: 'Qxf7#', moveUci: 'h5f7', mover: 'white' }
      ]
    };
    const evals = [
      { ply: 0, fen: beforeMateFen, depth: 16, lines: [{ moveUci: 'h5f7', moveSan: 'Qxf7#', cp: null, mateIn: 1 }] },
      { ply: 1, fen: afterMateFen, depth: 16, lines: [] }
    ];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(0);
    expect(whiteMove?.quality).toBe('best');
  });

  test('returns an empty array for a zero-move game', () => {
    const game: ParsedGame = {
      headers: {},
      positions: [{ ply: 0, fen: START_FEN, moveSan: null, moveUci: null, mover: null }]
    };
    const evals = [evalAt(START_FEN, 0)];

    expect(classifyMoves(game, evals, 'white')).toEqual([]);
  });
});

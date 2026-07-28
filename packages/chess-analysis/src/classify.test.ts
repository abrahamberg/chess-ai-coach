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
  test('cpLoss 0 (played the engine-best move) classifies as good', () => {
    const game = twoPlyGame();
    const evals = [evalAt(START_FEN, 30), evalAt(AFTER_E4_FEN, 30), evalAt(AFTER_E4_E5_FEN, 30)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(0);
    expect(whiteMove?.quality).toBe('good');
  });

  test('cpLoss 75 classifies as inaccuracy', () => {
    const game = twoPlyGame();
    // White to move at ply 0: best = +100 (white perspective). White plays a
    // move leaving the position at ply 1 with best = +25 (still white
    // perspective, mover is white so no sign flip). 100 - 25 = 75.
    const evals = [evalAt(START_FEN, 100), evalAt(AFTER_E4_FEN, 25), evalAt(AFTER_E4_E5_FEN, 25)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(75);
    expect(whiteMove?.quality).toBe('inaccuracy');
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
    expect(blackMove?.quality).toBe('good');
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
    expect(blackMove?.quality).toBe('good');
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

  test('returns an empty array for a zero-move game', () => {
    const game: ParsedGame = {
      headers: {},
      positions: [{ ply: 0, fen: START_FEN, moveSan: null, moveUci: null, mover: null }]
    };
    const evals = [evalAt(START_FEN, 0)];

    expect(classifyMoves(game, evals, 'white')).toEqual([]);
  });
});

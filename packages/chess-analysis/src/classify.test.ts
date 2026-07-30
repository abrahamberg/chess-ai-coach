import type { EngineEval, EngineLine } from '@chess-coach/shared';
import { describe, expect, test } from 'vitest';
import type { ParsedGame } from './pgn.js';
import { classifyMoves, expectedPoints, hangsPiece, isSoundQuality, qualityFor } from './classify.js';

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

function line(moveSan: string, cp: number | null, mateIn: number | null = null): EngineLine {
  return { moveUci: 'e2e4', moveSan, cp, mateIn };
}

function evalWithLines(fen: string, lines: EngineLine[]): EngineEval {
  return { ply: 0, fen, depth: 18, lines };
}

describe('expectedPoints', () => {
  test('cp=0 is exactly 0.5 (a coin flip)', () => {
    expect(expectedPoints(0)).toBeCloseTo(0.5, 10);
  });

  test('is symmetric around 0', () => {
    expect(expectedPoints(-200)).toBeCloseTo(1 - expectedPoints(200), 10);
  });

  test('is monotonically increasing', () => {
    expect(expectedPoints(-100)).toBeLessThan(expectedPoints(0));
    expect(expectedPoints(0)).toBeLessThan(expectedPoints(100));
    expect(expectedPoints(100)).toBeLessThan(expectedPoints(500));
  });

  test('saturates toward 1 for a large positive score (e.g. a clamped mate score)', () => {
    expect(expectedPoints(1000)).toBeGreaterThan(0.97);
    expect(expectedPoints(1000)).toBeLessThan(1);
  });

  test('saturates toward 0 for a large negative score', () => {
    expect(expectedPoints(-1000)).toBeLessThan(0.03);
    expect(expectedPoints(-1000)).toBeGreaterThan(0);
  });
});

describe('qualityFor', () => {
  test('cpLoss 0 is always best, regardless of epLoss', () => {
    expect(qualityFor(0, 0)).toBe('best');
  });

  test('epLoss just below the interesting boundary (0.05) is good', () => {
    expect(qualityFor(50, 0.049)).toBe('good');
  });

  test('epLoss at the interesting boundary (0.05) is interesting', () => {
    expect(qualityFor(50, 0.05)).toBe('interesting');
  });

  test('epLoss just below the dubious boundary (0.10) stays interesting', () => {
    expect(qualityFor(100, 0.099)).toBe('interesting');
  });

  test('epLoss at the dubious boundary (0.10) is dubious', () => {
    expect(qualityFor(100, 0.1)).toBe('dubious');
  });

  test('epLoss at the mistake boundary (0.20) is mistake', () => {
    expect(qualityFor(200, 0.2)).toBe('mistake');
  });

  test('epLoss at the blunder boundary (0.30) is blunder', () => {
    expect(qualityFor(300, 0.3)).toBe('blunder');
  });

  test('epLoss well past the blunder boundary is still blunder', () => {
    expect(qualityFor(900, 0.95)).toBe('blunder');
  });

  test('a sacrifice with low epLoss is brilliant', () => {
    expect(qualityFor(10, 0.01, true)).toBe('brilliant');
  });

  test('a sacrifice with high epLoss is not brilliant -- the ladder wins', () => {
    expect(qualityFor(300, 0.25, true)).toBe('mistake');
  });

  test('isMiss overrides the ladder result when the epLoss has not reached mistake severity', () => {
    expect(qualityFor(150, 0.15, false, true)).toBe('miss');
  });

  test('isMiss overrides even a would-be brilliant sacrifice', () => {
    expect(qualityFor(10, 0.01, true, true)).toBe('miss');
  });

  test('isMiss does not override when the move is already independently severe (blunder-range epLoss)', () => {
    expect(qualityFor(800, 0.45, false, true)).toBe('blunder');
  });

  test('cpLoss 1 (not exactly 0) with tiny epLoss is good, not best', () => {
    expect(qualityFor(1, 0.001)).toBe('good');
  });
});

describe('classifyMoves', () => {
  test('cpLoss 0 (played the engine-best move) classifies as best', () => {
    const game = twoPlyGame();
    const evals = [evalAt(START_FEN, 30), evalAt(AFTER_E4_FEN, 30), evalAt(AFTER_E4_E5_FEN, 30)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(0);
    expect(whiteMove?.quality).toBe('best');
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
    const beforeFen = '4k3/3p4/4B3/8/8/8/8/4K3 w - - 0 1';
    const afterFen = '4k3/3B4/8/8/8/8/8/4K3 b - - 0 1';
    const game: ParsedGame = {
      headers: {},
      positions: [
        { ply: 0, fen: beforeFen, moveSan: null, moveUci: null, mover: null },
        { ply: 1, fen: afterFen, moveSan: 'Bxd7', moveUci: 'e6d7', mover: 'white' }
      ]
    };
    const evals = [evalAt(beforeFen, 0), evalAt(afterFen, 0)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.quality).toBe('best');
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

  test('the EP-loss ladder is wired end-to-end through classifyMoves (not just qualityFor in isolation)', () => {
    const game = twoPlyGame();
    // bestCp=0, playedCp=-500 (mover perspective) -> epLoss = expectedPoints(0)
    // - expectedPoints(-500) ~= 0.5 - 0.137 ~= 0.363, past the 0.30 blunder
    // boundary.
    const evals = [evalAt(START_FEN, 0), evalAt(AFTER_E4_FEN, -500), evalAt(AFTER_E4_E5_FEN, -500)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(500);
    expect(whiteMove?.quality).toBe('blunder');
  });

  test('a large multiPv gap overrides to miss even when the move played was still nearly winning (EP saturation)', () => {
    const game = twoPlyGame();
    // Best line is mate-in-5 (+1000cp); the move actually played (e4) leaves a
    // position evaluated at only +700 -- still winning big, so naive epLoss
    // (expectedPoints(1000) - expectedPoints(700) ~= 0.046) would read as
    // 'good'. The 300cp raw gap to the second-best line is what catches this.
    const evals = [
      evalWithLines(START_FEN, [line('Qxf7', null, 5), line('e4', 700)]),
      evalAt(AFTER_E4_FEN, 700),
      evalAt(AFTER_E4_E5_FEN, 700)
    ];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.quality).toBe('miss');
  });

  test('a large multiPv gap does not override a genuinely severe blunder', () => {
    const game = twoPlyGame();
    // Best line is Nc3, keeping things equal (0cp) -- not the move actually
    // played (e4, per twoPlyGame's fixture). Second-best line is already bad
    // (-500cp, gap 500 >= MISS_GAP_CP), which would trigger the raw multiPv
    // isMiss signal. But the player's actual move (e4) leaves the position
    // at -800cp -- a severe, independently-bad blunder (epLoss ~0.45, well
    // past BLUNDER_EP) that should keep its real severity rather than being
    // masked as 'miss'.
    const evals = [
      evalWithLines(START_FEN, [line('Nc3', 0), line('Nf3', -500)]),
      evalAt(AFTER_E4_FEN, -800),
      evalAt(AFTER_E4_E5_FEN, -800)
    ];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.quality).toBe('blunder');
  });

  test('does not flag miss when the player found the engine-best move, regardless of the gap to the second line', () => {
    const game = twoPlyGame();
    const evals = [
      evalWithLines(START_FEN, [line('e4', 900), line('Nf3', 100)]),
      evalAt(AFTER_E4_FEN, 900),
      evalAt(AFTER_E4_E5_FEN, 900)
    ];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(0);
    expect(whiteMove?.quality).toBe('best');
  });

  test('does not flag miss when the multiPv gap is below the 300cp threshold', () => {
    const game = twoPlyGame();
    const evals = [
      evalWithLines(START_FEN, [line('Nxf7', 400), line('e4', 200)]),
      evalAt(AFTER_E4_FEN, 200),
      evalAt(AFTER_E4_E5_FEN, 200)
    ];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(200);
    expect(whiteMove?.quality).toBe('dubious');
  });

  test('does not flag miss when evalBefore has only one line (no multiPv data)', () => {
    const game = twoPlyGame();
    const evals = [evalAt(START_FEN, 900), evalAt(AFTER_E4_FEN, 200), evalAt(AFTER_E4_E5_FEN, 200)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(700);
    expect(whiteMove?.quality).toBe('mistake');
  });

  test('a move ending in # (delivered mate) is never classified as miss, even with a large multiPv gap to a different top line', () => {
    const game: ParsedGame = {
      headers: {},
      positions: [
        { ply: 0, fen: START_FEN, moveSan: null, moveUci: null, mover: null },
        { ply: 1, fen: AFTER_E4_FEN, moveSan: 'e4#', moveUci: 'e2e4', mover: 'white' }
      ]
    };
    const evals = [evalWithLines(START_FEN, [line('Qxf7', null, 1), line('e4', 50)]), evalAt(AFTER_E4_FEN, 1000)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(0);
    expect(whiteMove?.quality).toBe('best');
  });

  test('classifyMoves surfaces hangsPiece on the returned move', () => {
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

    expect(whiteMove?.hangsPiece).toBe(true);
  });
});

describe('isSoundQuality', () => {
  test('miss is not sound (it is a real error, just from a winning position)', () => {
    expect(isSoundQuality('miss')).toBe(false);
  });

  test('best is sound', () => {
    expect(isSoundQuality('best')).toBe(true);
  });
});

describe('hangsPiece', () => {
  test('a non-capture move onto an attacked, undefended square hangs the piece', () => {
    // White bishop c4-e6: e6 is attacked by black pawns d7/f7, and no white
    // piece defends it.
    const beforeFen = '4k3/3p1p2/8/8/2B5/8/8/4K3 w - - 0 1';
    expect(hangsPiece(beforeFen, 'Be6')).toBe(true);
  });

  test('a move onto an attacked square that a friendly piece defends does not hang', () => {
    // Same bishop move, but a white rook on e1 defends e6 down the open e-file.
    const beforeFen = '4k3/3p1p2/8/8/2B5/8/8/4RK2 w - - 0 1';
    expect(hangsPiece(beforeFen, 'Be6')).toBe(false);
  });

  test('a move onto an unattacked square does not hang', () => {
    const beforeFen = '4k3/8/8/8/2B5/8/8/4K3 w - - 0 1';
    expect(hangsPiece(beforeFen, 'Be6')).toBe(false);
  });

  test('a pawn move is never flagged, even onto an attacked, undefended square', () => {
    // White pawn d4-d5: a black knight on b6 attacks d5, nothing defends it,
    // but pawn moves are excluded regardless.
    const beforeFen = '4k3/8/1n6/8/3P4/8/8/4K3 w - - 0 1';
    expect(hangsPiece(beforeFen, 'd5')).toBe(false);
  });

  test('a capture that leaves the capturing piece hanging still counts (unlike isSacrifice)', () => {
    // Bxd7: bishop on e6 captures a pawn on d7, landing on a square the black king
    // attacks, with no white defender.
    const beforeFen = '4k3/3p4/4B3/8/8/8/8/4K3 w - - 0 1';
    expect(hangsPiece(beforeFen, 'Bxd7')).toBe(true);
  });

  test('an illegal move string returns false rather than throwing', () => {
    const beforeFen = '4k3/8/8/8/2B5/8/8/4K3 w - - 0 1';
    expect(hangsPiece(beforeFen, 'Zz9')).toBe(false);
  });
});

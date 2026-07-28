import { Chess } from 'chess.js';
import { describe, expect, test } from 'vitest';
import { InvalidPgnError, detectUserColor, parsePgn } from './pgn.js';

const SCHOLARS_MATE_PGN = `[Event "Test"]
[Site "?"]
[Date "2024.01.01"]
[Round "1"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

const MULTI_GAME_PGN = `[Event "Game 1"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 1-0

[Event "Game 2"]
[White "Carol"]
[Black "Dave"]
[Result "0-1"]

1. d4 d5 0-1`;

const ZERO_MOVE_PGN = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "*"]

*`;

const PROMOTION_PGN = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "*"]

1. a4 h5 2. a5 h4 3. a6 h3 4. axb7 hxg2 5. bxa8=Q gxh1=Q *`;

const GARBAGE_PGN = 'this is not a pgn at all !! 1231234';

const FROM_POSITION_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

const FROM_POSITION_PGN = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "*"]
[SetUp "1"]
[FEN "${FROM_POSITION_FEN}"]

3. Bc4 Nf6 4. Ng5 *`;

const ILLEGAL_FEN_HEADER_PGN = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "*"]
[SetUp "1"]
[FEN "not-a-fen"]

*`;

describe('parsePgn', () => {
  test('parses scholars mate into a position for every ply, ending in checkmate', () => {
    const game = parsePgn(SCHOLARS_MATE_PGN);

    // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6 4.Qxf7# is 7 half-moves (plies), so 8
    // positions: the start position plus one position per ply played.
    expect(game.positions).toHaveLength(8);

    const start = game.positions[0]!;
    expect(start).toEqual({
      ply: 0,
      fen: new Chess().fen(),
      moveSan: null,
      moveUci: null,
      mover: null
    });

    const last = game.positions[game.positions.length - 1]!;
    expect(last.ply).toBe(7);
    expect(last.moveSan).toBe('Qxf7#');
    expect(last.moveUci).toBe('h5f7');
    expect(last.mover).toBe('white');
    expect(new Chess(last.fen).isCheckmate()).toBe(true);
  });

  test('extracts PGN headers', () => {
    const game = parsePgn(SCHOLARS_MATE_PGN);

    expect(game.headers['White']).toBe('Alice');
    expect(game.headers['Black']).toBe('Bob');
    expect(game.headers['Result']).toBe('1-0');
  });

  test('parses only the first game when given a multi-game PGN', () => {
    const game = parsePgn(MULTI_GAME_PGN);

    expect(game.headers['Event']).toBe('Game 1');
    expect(game.headers['White']).toBe('Alice');
    // 1.e4 e5 2.Nf3 is 3 plies -> 4 positions.
    expect(game.positions).toHaveLength(4);
  });

  test('a PGN with valid headers and zero moves yields a single starting position', () => {
    const game = parsePgn(ZERO_MOVE_PGN);

    expect(game.positions).toHaveLength(1);
    expect(game.positions[0]).toEqual({
      ply: 0,
      fen: new Chess().fen(),
      moveSan: null,
      moveUci: null,
      mover: null
    });
  });

  test('builds moveUci as from+to+promotion for promotion moves', () => {
    const game = parsePgn(PROMOTION_PGN);

    const whitePromotion = game.positions.find((position) => position.moveSan === 'bxa8=Q');
    const blackPromotion = game.positions.find((position) => position.moveSan === 'gxh1=Q');

    expect(whitePromotion?.moveUci).toBe('b7a8q');
    expect(whitePromotion?.mover).toBe('white');
    expect(blackPromotion?.moveUci).toBe('g2h1q');
    expect(blackPromotion?.mover).toBe('black');
  });

  test('replays from a custom [FEN]/[SetUp] starting position instead of the standard array', () => {
    const game = parsePgn(FROM_POSITION_PGN);

    expect(game.headers['FEN']).toBe(FROM_POSITION_FEN);
    expect(game.positions).toHaveLength(4);

    const start = game.positions[0]!;
    expect(start).toEqual({
      ply: 0,
      fen: FROM_POSITION_FEN,
      moveSan: null,
      moveUci: null,
      mover: null
    });

    expect(game.positions[1]).toEqual({
      ply: 1,
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
      moveSan: 'Bc4',
      moveUci: 'f1c4',
      mover: 'white'
    });
    expect(game.positions[2]).toEqual({
      ply: 2,
      fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
      moveSan: 'Nf6',
      moveUci: 'g8f6',
      mover: 'black'
    });
    expect(game.positions[3]).toEqual({
      ply: 3,
      fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R b KQkq - 5 4',
      moveSan: 'Ng5',
      moveUci: 'f3g5',
      mover: 'white'
    });
  });

  test('throws InvalidPgnError when the [FEN] header is not a legal FEN', () => {
    expect(() => parsePgn(ILLEGAL_FEN_HEADER_PGN)).toThrow(InvalidPgnError);
  });

  test('throws InvalidPgnError on corrupt PGN', () => {
    expect(() => parsePgn(GARBAGE_PGN)).toThrow(InvalidPgnError);
  });

  test('throws InvalidPgnError on an illegal move sequence', () => {
    const illegalMovePgn = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "*"]

1. e4 e4 *`;

    expect(() => parsePgn(illegalMovePgn)).toThrow(InvalidPgnError);
  });
});

describe('detectUserColor', () => {
  const headers = { White: 'MagnusCarlsen', Black: 'HikaruNakamura' };

  test('matches the white player case-insensitively on lichess username', () => {
    expect(detectUserColor(headers, { lichess: 'magnuscarlsen', displayName: 'someone' })).toBe(
      'white'
    );
  });

  test('matches the black player case-insensitively on chess.com username', () => {
    expect(
      detectUserColor(headers, { chesscom: 'HIKARUNAKAMURA', displayName: 'someone' })
    ).toBe('black');
  });

  test('matches on displayName', () => {
    expect(detectUserColor(headers, { displayName: 'magnuscarlsen' })).toBe('white');
  });

  test('returns null when no username matches either side', () => {
    expect(
      detectUserColor(headers, {
        lichess: 'nobody',
        chesscom: 'nobody-else',
        displayName: 'still-nobody'
      })
    ).toBeNull();
  });

  test('returns null when both sides match', () => {
    expect(
      detectUserColor(headers, {
        lichess: 'magnuscarlsen',
        chesscom: 'hikarunakamura',
        displayName: 'irrelevant'
      })
    ).toBeNull();
  });
});

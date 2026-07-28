import { Chess } from 'chess.js';
import type { Color, Move } from 'chess.js';

export class InvalidPgnError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InvalidPgnError';
  }
}

export interface ParsedPosition {
  ply: number;
  fen: string;
  moveSan: string | null;
  moveUci: string | null;
  mover: 'white' | 'black' | null;
}

export interface ParsedGame {
  headers: Record<string, string>;
  positions: ParsedPosition[];
}

export interface Usernames {
  lichess?: string;
  chesscom?: string;
  displayName: string;
}

/**
 * Parses a single-game PGN into its headers and the sequence of positions
 * (one per ply, plus the starting position) reached along the mainline.
 *
 * If given a PGN containing multiple games, only the first game is parsed.
 */
export function parsePgn(pgn: string): ParsedGame {
  const chess = loadFirstGame(pgn);
  return {
    headers: chess.getHeaders(),
    positions: buildPositions(chess)
  };
}

/**
 * Determines which side the given usernames belong to by comparing them
 * case-insensitively against the PGN's White/Black headers.
 *
 * Returns null when no username matches either side, or when usernames
 * match both sides (an ambiguous result).
 */
export function detectUserColor(
  headers: Record<string, string>,
  usernames: Usernames
): 'white' | 'black' | null {
  const candidates = collectCandidateUsernames(usernames);
  const isWhiteMatch = matchesAnyUsername(headers['White'], candidates);
  const isBlackMatch = matchesAnyUsername(headers['Black'], candidates);

  if (isWhiteMatch && isBlackMatch) return null;
  if (isWhiteMatch) return 'white';
  if (isBlackMatch) return 'black';
  return null;
}

function collectCandidateUsernames(usernames: Usernames): string[] {
  return [usernames.lichess, usernames.chesscom, usernames.displayName]
    .filter((name): name is string => Boolean(name))
    .map((name) => name.toLowerCase());
}

function matchesAnyUsername(headerValue: string | undefined, candidates: string[]): boolean {
  if (!headerValue) return false;
  return candidates.includes(headerValue.toLowerCase());
}

/** Loads the first game of a (possibly multi-game) PGN string into a Chess instance. */
function loadFirstGame(pgn: string): Chess {
  const firstGamePgn = extractFirstGame(pgn);
  const chess = new Chess();
  try {
    chess.loadPgn(firstGamePgn);
  } catch (error) {
    throw new InvalidPgnError(`Invalid PGN: ${describeError(error)}`, { cause: error });
  }
  return chess;
}

/**
 * Cuts a multi-game PGN down to just its first game, splitting on the
 * boundary before the second game's `[Event ` header tag.
 */
function extractFirstGame(pgn: string): string {
  const eventHeaderStarts = [...pgn.matchAll(/^\[Event\s/gm)].map((match) => match.index);
  const secondGameStart = eventHeaderStarts[1];
  if (eventHeaderStarts.length < 2 || secondGameStart === undefined) return pgn;
  return pgn.slice(0, secondGameStart).trimEnd();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Replays a loaded game's moves on a board seeded at the game's actual
 * starting position, collecting the FEN after every ply.
 *
 * The starting position is usually the standard array, but a PGN carrying a
 * `[FEN]` header (with or without `[SetUp "1"]`, which chess.js honors either
 * way) starts from that custom position instead — reading it off the first
 * move's `before` FEN (or, for a zero-move game, off the loaded game's
 * current FEN) keeps this correct without re-parsing headers ourselves.
 */
function buildPositions(chess: Chess): ParsedPosition[] {
  const moves = chess.history({ verbose: true });
  const startingFen = moves[0]?.before ?? chess.fen();
  const replay = new Chess(startingFen);
  const positions: ParsedPosition[] = [startingPosition(replay.fen())];

  for (const move of moves) {
    replay.move({ from: move.from, to: move.to, promotion: move.promotion });
    positions.push(positionAfterMove(positions.length, replay.fen(), move));
  }

  return positions;
}

function startingPosition(fen: string): ParsedPosition {
  return { ply: 0, fen, moveSan: null, moveUci: null, mover: null };
}

function positionAfterMove(ply: number, fen: string, move: Move): ParsedPosition {
  return {
    ply,
    fen,
    moveSan: move.san,
    moveUci: buildMoveUci(move),
    mover: colorToMover(move.color)
  };
}

function buildMoveUci(move: Pick<Move, 'from' | 'to' | 'promotion'>): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function colorToMover(color: Color): 'white' | 'black' {
  return color === 'w' ? 'white' : 'black';
}

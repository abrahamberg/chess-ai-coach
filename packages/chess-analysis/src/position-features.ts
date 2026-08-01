import { Chess, SQUARES, type Color, type PieceSymbol, type Square } from 'chess.js';
import type { PositionFeatures } from '@chess-coach/shared';

/** Same static piece-value table classify.ts uses for its sacrifice/hangs
 * heuristics — not engine-precise, just enough for "worth more than" checks. */
const PIECE_VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const CENTER_SQUARES: Square[] = ['d4', 'd5', 'e4', 'e5'];
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
type FileLetter = (typeof FILES)[number];

type ColorName = 'white' | 'black';

interface OccupiedSquare {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

/** square -> attacking squares, by attacker color. Built once per position and
 * shared by every feature below — 128 chess.js `attackers()` calls (2 colors
 * x 64 squares) instead of each feature re-scanning the board itself. */
interface AttackMap {
  attackersOf: Map<Square, { white: Square[]; black: Square[] }>;
  /** Inverse of attackersOf: piece square -> squares it attacks/defends. */
  controlledBy: Map<Square, Square[]>;
}

/**
 * Pure, engine-independent static analysis of a single FEN via chess.js —
 * no Stockfish call, safe to run on every interactive position request.
 * Every sub-feature is a small named function below so each is independently
 * testable; this just assembles them.
 */
export function computePositionFeatures(fen: string): PositionFeatures {
  const chess = new Chess(fen);
  const attackMap = buildAttackMap(chess);

  return {
    turn: toColorName(chess.turn()),
    boardState: boardState(chess),
    availableMoves: chess.moves(),
    mobility: mobility(chess, attackMap),
    controlledSquares: controlledSquares(chess, attackMap),
    piecesUnderAttack: piecesUnderAttack(chess, attackMap),
    hangingPieces: hangingPieces(chess, attackMap),
    underDefendedPieces: underDefendedPieces(chess, attackMap),
    overloadedDefenders: overloadedDefenders(chess, attackMap),
    centerControlScore: centerControlScore(attackMap),
    ...pawnStructure(chess),
    targetsAttacked: targetsAttacked(chess, attackMap),
    forks: forks(chess, attackMap),
    captureOpportunities: captureOpportunities(chess, attackMap)
  };
}

function buildAttackMap(chess: Chess): AttackMap {
  const attackersOf: AttackMap['attackersOf'] = new Map();
  const controlledBy: AttackMap['controlledBy'] = new Map();

  for (const square of SQUARES) {
    const white = chess.attackers(square, 'w');
    const black = chess.attackers(square, 'b');
    attackersOf.set(square, { white, black });
    for (const attacker of white) addControlled(controlledBy, attacker, square);
    for (const attacker of black) addControlled(controlledBy, attacker, square);
  }
  return { attackersOf, controlledBy };
}

function addControlled(map: Map<Square, Square[]>, from: Square, to: Square): void {
  const existing = map.get(from);
  if (existing) existing.push(to);
  else map.set(from, [to]);
}

function toColorName(color: Color): ColorName {
  return color === 'w' ? 'white' : 'black';
}

function opponentOf(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

function occupiedSquares(chess: Chess): OccupiedSquare[] {
  return chess
    .board()
    .flat()
    .filter((piece): piece is OccupiedSquare => piece !== null);
}

function boardState(chess: Chess): PositionFeatures['boardState'] {
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isCheck()) return 'check';
  return 'none';
}

/**
 * Total squares each side's pieces attack/defend (summed per piece, overlaps
 * counted once per piece) — an attack-based "how active are your pieces"
 * metric, not a legal-move count. A true legal-move count for the side NOT
 * on move isn't a well-defined chess concept (it depends on whose turn it
 * is, e.g. when the side to move is in check), so both sides are scored the
 * same attack-based way for consistency.
 */
function mobility(chess: Chess, attackMap: AttackMap): PositionFeatures['mobility'] {
  let white = 0;
  let black = 0;
  for (const piece of occupiedSquares(chess)) {
    const count = attackMap.controlledBy.get(piece.square)?.length ?? 0;
    if (piece.color === 'w') white += count;
    else black += count;
  }
  return { white, black };
}

function controlledSquares(chess: Chess, attackMap: AttackMap): PositionFeatures['controlledSquares'] {
  return occupiedSquares(chess).map((piece) => ({
    square: piece.square,
    piece: piece.type,
    color: toColorName(piece.color),
    squares: attackMap.controlledBy.get(piece.square) ?? []
  }));
}

interface AttackedPieceInfo {
  square: Square;
  piece: PieceSymbol;
  color: ColorName;
  attackers: number;
  defenders: number;
}

/** Every occupied square with attackers > 0, and its attacker/defender
 * counts — the shared basis for piecesUnderAttack/hangingPieces/
 * underDefendedPieces/overloadedDefenders below. */
function attackedPieceInfos(chess: Chess, attackMap: AttackMap): AttackedPieceInfo[] {
  const infos: AttackedPieceInfo[] = [];
  for (const piece of occupiedSquares(chess)) {
    const entry = attackMap.attackersOf.get(piece.square);
    if (!entry) continue;
    const attackerColor = toColorName(opponentOf(piece.color));
    const defenderColor = toColorName(piece.color);
    const attackers = entry[attackerColor].length;
    if (attackers === 0) continue;
    infos.push({
      square: piece.square,
      piece: piece.type,
      color: toColorName(piece.color),
      attackers,
      defenders: entry[defenderColor].length
    });
  }
  return infos;
}

function piecesUnderAttack(chess: Chess, attackMap: AttackMap): PositionFeatures['piecesUnderAttack'] {
  return attackedPieceInfos(chess, attackMap);
}

function hangingPieces(chess: Chess, attackMap: AttackMap): PositionFeatures['hangingPieces'] {
  return attackedPieceInfos(chess, attackMap).filter((info) => info.defenders === 0);
}

/** Attacked more times than defended, but not fully hanging (defenders > 0)
 * — hangingPieces already owns the zero-defenders case, so the two lists
 * never overlap. */
function underDefendedPieces(chess: Chess, attackMap: AttackMap): PositionFeatures['underDefendedPieces'] {
  return attackedPieceInfos(chess, attackMap).filter((info) => info.defenders > 0 && info.attackers > info.defenders);
}

/** A defender that is the SOLE defender of 2+ attacked pieces. */
function overloadedDefenders(chess: Chess, attackMap: AttackMap): PositionFeatures['overloadedDefenders'] {
  const soleDefenderOf = new Map<Square, Square[]>();
  for (const info of attackedPieceInfos(chess, attackMap)) {
    const entry = attackMap.attackersOf.get(info.square);
    const defenders = entry?.[info.color] ?? [];
    if (defenders.length !== 1) continue;
    const [defender] = defenders;
    if (!defender) continue;
    const defending = soleDefenderOf.get(defender);
    if (defending) defending.push(info.square);
    else soleDefenderOf.set(defender, [info.square]);
  }
  return Array.from(soleDefenderOf.entries())
    .filter(([, defending]) => defending.length >= 2)
    .map(([square, defending]) => ({ square, defending }));
}

function centerControlScore(attackMap: AttackMap): PositionFeatures['centerControlScore'] {
  let white = 0;
  let black = 0;
  for (const square of CENTER_SQUARES) {
    const entry = attackMap.attackersOf.get(square);
    if (!entry) continue;
    white += entry.white.length;
    black += entry.black.length;
  }
  return { white, black };
}

interface PawnStructureResult {
  openFiles: PositionFeatures['openFiles'];
  semiOpenFiles: PositionFeatures['semiOpenFiles'];
  doubledPawns: PositionFeatures['doubledPawns'];
  isolatedPawns: PositionFeatures['isolatedPawns'];
  passedPawns: PositionFeatures['passedPawns'];
}

function pawnStructure(chess: Chess): PawnStructureResult {
  const pawnsByFile = new Map<string, { white: Square[]; black: Square[] }>();
  for (const file of FILES) pawnsByFile.set(file, { white: [], black: [] });

  for (const piece of occupiedSquares(chess)) {
    if (piece.type !== 'p') continue;
    const entry = pawnsByFile.get(fileOf(piece.square));
    entry?.[toColorName(piece.color)].push(piece.square);
  }

  return {
    openFiles: openFiles(pawnsByFile),
    semiOpenFiles: semiOpenFiles(pawnsByFile),
    doubledPawns: doubledPawns(pawnsByFile),
    isolatedPawns: isolatedPawns(pawnsByFile),
    passedPawns: passedPawns(pawnsByFile)
  };
}

function fileOf(square: Square): string {
  return square[0] ?? '';
}

function rankOf(square: Square): number {
  return Number(square[1]);
}

function openFiles(pawnsByFile: Map<string, { white: Square[]; black: Square[] }>): string[] {
  return FILES.filter((file) => {
    const entry = pawnsByFile.get(file);
    return entry?.white.length === 0 && entry.black.length === 0;
  });
}

function semiOpenFiles(
  pawnsByFile: Map<string, { white: Square[]; black: Square[] }>
): PositionFeatures['semiOpenFiles'] {
  const result: PositionFeatures['semiOpenFiles'] = [];
  for (const file of FILES) {
    const entry = pawnsByFile.get(file);
    if (!entry) continue;
    if (entry.white.length === 0 && entry.black.length > 0) result.push({ file, openFor: 'white' });
    else if (entry.black.length === 0 && entry.white.length > 0) result.push({ file, openFor: 'black' });
  }
  return result;
}

function doubledPawns(pawnsByFile: Map<string, { white: Square[]; black: Square[] }>): PositionFeatures['doubledPawns'] {
  const result: PositionFeatures['doubledPawns'] = [];
  for (const file of FILES) {
    const entry = pawnsByFile.get(file);
    if (!entry) continue;
    if (entry.white.length >= 2) result.push({ file, color: 'white', count: entry.white.length });
    if (entry.black.length >= 2) result.push({ file, color: 'black', count: entry.black.length });
  }
  return result;
}

function isolatedPawns(pawnsByFile: Map<string, { white: Square[]; black: Square[] }>): PositionFeatures['isolatedPawns'] {
  const result: PositionFeatures['isolatedPawns'] = [];
  for (const [index, file] of FILES.entries()) {
    const entry = pawnsByFile.get(file);
    if (!entry) continue;
    const neighborFiles = [FILES[index - 1], FILES[index + 1]].filter((f): f is FileLetter => f !== undefined);
    for (const color of ['white', 'black'] as const) {
      const hasNeighborPawn = neighborFiles.some((f) => (pawnsByFile.get(f)?.[color].length ?? 0) > 0);
      if (hasNeighborPawn) continue;
      for (const square of entry[color]) result.push({ square, color });
    }
  }
  return result;
}

function passedPawns(pawnsByFile: Map<string, { white: Square[]; black: Square[] }>): PositionFeatures['passedPawns'] {
  const result: PositionFeatures['passedPawns'] = [];
  for (const [index, file] of FILES.entries()) {
    const entry = pawnsByFile.get(file);
    if (!entry) continue;
    const spanFiles = [FILES[index - 1], file, FILES[index + 1]].filter((f): f is FileLetter => f !== undefined);

    for (const pawn of entry.white) {
      const blocked = spanFiles.some((f) => (pawnsByFile.get(f)?.black ?? []).some((sq) => rankOf(sq) > rankOf(pawn)));
      if (!blocked) result.push({ square: pawn, color: 'white' });
    }
    for (const pawn of entry.black) {
      const blocked = spanFiles.some((f) => (pawnsByFile.get(f)?.white ?? []).some((sq) => rankOf(sq) < rankOf(pawn)));
      if (!blocked) result.push({ square: pawn, color: 'black' });
    }
  }
  return result;
}

function targetsAttacked(chess: Chess, attackMap: AttackMap): PositionFeatures['targetsAttacked'] {
  const mover = chess.turn();
  const opponent = opponentOf(mover);
  const opponentSquares = new Set(
    occupiedSquares(chess)
      .filter((piece) => piece.color === opponent)
      .map((piece) => piece.square)
  );

  const result: PositionFeatures['targetsAttacked'] = [];
  for (const piece of occupiedSquares(chess).filter((p) => p.color === mover)) {
    const controlled = attackMap.controlledBy.get(piece.square) ?? [];
    const targets = controlled.filter((square) => opponentSquares.has(square));
    if (targets.length > 0) result.push({ from: piece.square, piece: piece.type, targets });
  }
  return result;
}

/**
 * A non-king piece attacking 2+ enemy pieces at once, where at least one
 * fork victim is worth more than the forker or is undefended — otherwise
 * every double-attack (common, usually harmless) would qualify.
 */
function forks(chess: Chess, attackMap: AttackMap): PositionFeatures['forks'] {
  const result: PositionFeatures['forks'] = [];
  for (const piece of occupiedSquares(chess)) {
    if (piece.type === 'k') continue;
    const opponent = opponentOf(piece.color);
    const controlled = attackMap.controlledBy.get(piece.square) ?? [];
    const enemyTargets = controlled.filter((square) => chess.get(square)?.color === opponent);
    if (enemyTargets.length < 2) continue;

    const forkerValue = PIECE_VALUES[piece.type];
    const qualifies = enemyTargets.some((square) => {
      const target = chess.get(square);
      if (!target) return false;
      const defenders = attackMap.attackersOf.get(square)?.[toColorName(opponent)].length ?? 0;
      return PIECE_VALUES[target.type] > forkerValue || defenders === 0;
    });
    if (qualifies) result.push({ square: piece.square, piece: piece.type, forkedSquares: enemyTargets });
  }
  return result;
}

/**
 * Legal captures for the side to move, flagged favorable when the captured
 * piece is worth at least as much as the capturer, or the destination has no
 * defenders at all. One ply deep only — like classify.ts's isSacrifice/
 * hangsPiece, this ignores X-ray/discovered recaptures through the captured
 * piece.
 */
function captureOpportunities(chess: Chess, attackMap: AttackMap): PositionFeatures['captureOpportunities'] {
  return chess
    .moves({ verbose: true })
    .filter((move) => move.captured !== undefined)
    .map((move) => {
      const capturedPiece = move.captured as PieceSymbol;
      const capturerValue = PIECE_VALUES[move.piece];
      const capturedValue = PIECE_VALUES[capturedPiece];
      const defenders = attackMap.attackersOf.get(move.to)?.[toColorName(opponentOf(move.color))].length ?? 0;
      return {
        moveSan: move.san,
        from: move.from,
        to: move.to,
        capturedPiece,
        favorable: capturedValue >= capturerValue || defenders === 0
      };
    });
}

import type { Kysely } from 'kysely';
import type { MoveQuality } from '@chess-coach/shared';
import type { Database } from '../schema.js';

export interface GameMoveQualityRow {
  id: string;
  gameId: string;
  ply: number;
  moveSan: string;
  mover: 'white' | 'black';
  quality: MoveQuality;
  cpLoss: number;
  bestLineSan: string[];
  evalAfterCp: number;
  createdAt: Date;
}

export interface NewGameMoveQuality {
  gameId: string;
  ply: number;
  moveSan: string;
  mover: 'white' | 'black';
  quality: MoveQuality;
  cpLoss: number;
  bestLineSan: string[];
  evalAfterCp: number;
}

/** Play mode's live equivalent of the batch pipeline's analyses.classified_moves
 * — one row per move so undo can delete a single ply (see deleteByPly)
 * instead of rewriting a growing jsonb array. */
export function insert(db: Kysely<Database>, values: NewGameMoveQuality): Promise<GameMoveQualityRow> {
  return db
    .insertInto('gameMoveQualities')
    .values({ ...values, bestLineSan: JSON.stringify(values.bestLineSan) })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function listByGameId(db: Kysely<Database>, gameId: string): Promise<GameMoveQualityRow[]> {
  return db
    .selectFrom('gameMoveQualities')
    .selectAll()
    .where('gameId', '=', gameId)
    .orderBy('ply', 'asc')
    .execute();
}

/** Play-mode undo (architecture.md §14): the removed move's quality row is
 * deleted so nothing downstream (the "game so far" renderer, check_position,
 * recall_move) ever references a move that no longer exists. */
export function deleteByPly(db: Kysely<Database>, gameId: string, ply: number): Promise<void> {
  return db
    .deleteFrom('gameMoveQualities')
    .where('gameId', '=', gameId)
    .where('ply', '=', ply)
    .execute()
    .then(() => undefined);
}

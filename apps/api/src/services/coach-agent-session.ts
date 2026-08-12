import type { Kysely } from 'kysely';
import type { SessionMode } from '@chess-coach/shared';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import type { SessionMessageRow } from '../db/repositories/session-messages.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { NewSession, SessionRow } from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';

const SESSION_START_CONTENT = '[session_start]';

/** Session insert + `[session_start]` seed message — shared by analyze mode's
 * createSession (below) and play mode's createPlaySession (play-session.ts),
 * so the seeding logic exists in exactly one place. */
export async function createSessionForGame(db: Kysely<Database>, values: NewSession): Promise<SessionRow> {
  const session = await sessionsRepo.insert(db, values);
  await sessionMessagesRepo.insert(db, session.id, 'user', SESSION_START_CONTENT, session.subjectPly);
  return session;
}

export async function createSession(
  db: Kysely<Database>,
  userId: string,
  gameId: string,
  mode: SessionMode = 'analyze'
): Promise<SessionRow> {
  const game = await gamesRepo.findByIdForUser(db, gameId, userId);
  if (!game) throw new NotFoundError('Game not found');

  return createSessionForGame(db, { gameId: game.id, userId, mode });
}

/** The Games page's "start session" action: if the student already has an
 * ongoing session for this game, link back into it instead of starting a
 * second one over the same game. */
export async function resumeOrCreateSession(
  db: Kysely<Database>,
  userId: string,
  gameId: string
): Promise<SessionRow> {
  const existing = await sessionsRepo.findActiveByGameIdForUser(db, gameId, userId);
  if (existing) return existing;
  return createSession(db, userId, gameId);
}

/** Student-initiated "start over": abandons the current session and opens a
 * fresh one for the same game. */
export async function resetSession(db: Kysely<Database>, userId: string, sessionId: string): Promise<SessionRow> {
  const session = await sessionsRepo.findByIdForUser(db, sessionId, userId);
  if (!session) throw new NotFoundError('Session not found');
  if (session.status === 'completed' || session.status === 'abandoned') {
    throw new ConflictError('Session has already ended');
  }

  await sessionsRepo.markAbandoned(db, session.id);
  return createSession(db, userId, session.gameId);
}

export interface SessionDetail extends SessionRow {
  messages: SessionMessageRow[];
}

export async function getSessionDetail(
  db: Kysely<Database>,
  sessionId: string,
  userId: string
): Promise<SessionDetail | undefined> {
  const session = await sessionsRepo.findByIdForUser(db, sessionId, userId);
  if (!session) return undefined;
  const messages = await sessionMessagesRepo.listBySession(db, sessionId);
  return { ...session, messages: filterBackstageMessages(messages) };
}

const BACKSTAGE_TOOL_NAME = 'update_threads';

/** architecture §7.1: the thread ledger is backstage — never rendered to the
 * student. Strips update_threads tool-call/tool-result parts from each
 * message's content (keeping any other parts, e.g. spoken text alongside the
 * tool call), then drops any message left with no parts. */
function filterBackstageMessages(messages: SessionMessageRow[]): SessionMessageRow[] {
  return messages
    .map((message) => ({ ...message, content: stripBackstageParts(message.content) }))
    .filter((message) => !isEmptyContent(message.content));
}

function stripBackstageParts(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.filter((part) => !isBackstageToolPart(part));
}

function isBackstageToolPart(part: unknown): boolean {
  if (typeof part !== 'object' || part === null) return false;
  const candidate = part as { type?: unknown; toolName?: unknown };
  return (
    (candidate.type === 'tool-call' || candidate.type === 'tool-result') &&
    candidate.toolName === BACKSTAGE_TOOL_NAME
  );
}

function isEmptyContent(content: unknown): boolean {
  return Array.isArray(content) && content.length === 0;
}

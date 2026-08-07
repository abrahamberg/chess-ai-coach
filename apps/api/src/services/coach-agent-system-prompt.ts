import { buildCoachSystemPrompt } from '@chess-coach/prompts';
import type { Kysely } from 'kysely';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { SessionRow } from '../db/repositories/sessions.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { NotFoundError } from '../lib/errors.js';
import * as userProfileService from './user-profile.js';

type SystemPromptResult = { staticPart: string; dynamicPart: string; studentColor: 'white' | 'black' };

export async function buildSystemPromptForSession(
  db: Kysely<Database>,
  session: SessionRow
): Promise<SystemPromptResult> {
  if (session.mode === 'play') return buildPlayModeSystemPrompt(db, session);

  const [user, game, plan, profileSummary, sessionCount] = await Promise.all([
    usersRepo.findById(db, session.userId),
    gamesRepo.findById(db, session.gameId),
    analysesRepo.findCoachingPlanByGameId(db, session.gameId),
    userProfileService.getProfileSummary(db, session.userId),
    sessionsRepo.countByUser(db, session.userId)
  ]);
  if (!user) throw new NotFoundError('User not found');
  if (!game) throw new NotFoundError('Game not found');
  if (!plan) throw new NotFoundError('Coaching plan not found');

  const prompt = buildCoachSystemPrompt({
    user: { displayName: user.displayName, selfAssessment: user.selfAssessment, sessionCount },
    band: user.ratingBand,
    mode: 'analyze',
    game: {
      whiteName: game.whiteName ?? 'White',
      blackName: game.blackName ?? 'Black',
      result: game.result ?? '*',
      timeControl: game.timeControl ?? 'unknown',
      userColor: game.userColor
    },
    plan,
    focusAreas: profileSummary.focusAreas,
    recentFindings: profileSummary.recentFindings
  });
  return { ...prompt, studentColor: game.userColor };
}

/** architecture §14: never queries analysesRepo — a play-mode game never
 * gets an `analyses` row (there's no pre-game batch pipeline to produce
 * one), so `plan` is always null here rather than a lookup that would
 * always miss. */
async function buildPlayModeSystemPrompt(db: Kysely<Database>, session: SessionRow): Promise<SystemPromptResult> {
  const [user, game, profileSummary, sessionCount] = await Promise.all([
    usersRepo.findById(db, session.userId),
    gamesRepo.findById(db, session.gameId),
    userProfileService.getProfileSummary(db, session.userId),
    sessionsRepo.countByUser(db, session.userId)
  ]);
  if (!user) throw new NotFoundError('User not found');
  if (!game) throw new NotFoundError('Game not found');

  const prompt = buildCoachSystemPrompt({
    user: { displayName: user.displayName, selfAssessment: user.selfAssessment, sessionCount },
    band: user.ratingBand,
    mode: 'play',
    game: {
      whiteName: game.whiteName ?? 'White',
      blackName: game.blackName ?? 'Black',
      result: game.result ?? '*',
      timeControl: game.timeControl ?? 'unknown',
      userColor: game.userColor
    },
    plan: null,
    focusAreas: profileSummary.focusAreas,
    recentFindings: profileSummary.recentFindings
  });
  return { ...prompt, studentColor: game.userColor };
}

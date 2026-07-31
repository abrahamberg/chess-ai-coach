import { plyToMoveRef } from '@chess-coach/chess-analysis';
import { MISTAKE_CATEGORIES } from '@chess-coach/shared';
import type { CoachingPlan, MistakeCategory, Thread } from '@chess-coach/shared';

export const MISTAKE_CATEGORIES_BLOCK = MISTAKE_CATEGORIES.join(', ');

const FOCUS_AREAS_EMPTY_FALLBACK = '(none yet — this is early in your work together)';
const RECENT_FINDINGS_EMPTY_FALLBACK = '(none yet — no findings recorded so far)';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Coarse relative-date phrasing for prompt text (not UI-precise). */
export function relativeDate(date: Date, now: Date): string {
  const days = Math.floor((startOfDay(now).getTime() - startOfDay(date).getTime()) / MS_PER_DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export interface FocusAreaSummary {
  category: MistakeCategory;
  status: 'active' | 'improving' | 'resolved';
  note: string;
  evidenceCount: number;
  lastSeenAt: Date;
}

/** prompts.md §2.2: `- [status] category: note (seen Nx, last {date})`. */
export function renderFocusAreasBlock(focusAreas: FocusAreaSummary[], now: Date): string {
  if (focusAreas.length === 0) return FOCUS_AREAS_EMPTY_FALLBACK;
  return focusAreas
    .map(
      (area) =>
        `- [${area.status}] ${area.category}: ${area.note} (seen ${area.evidenceCount}x, last ${relativeDate(area.lastSeenAt, now)})`
    )
    .join('\n');
}

export interface RecentFinding {
  category: MistakeCategory;
  description: string;
  isPositive: boolean;
  createdAt: Date;
}

/** prompts.md §2.2: `- [+/-] category: description ({relative date})`. */
export function renderRecentFindingsBlock(findings: RecentFinding[], now: Date): string {
  if (findings.length === 0) return RECENT_FINDINGS_EMPTY_FALLBACK;
  return findings
    .map(
      (finding) =>
        `- [${finding.isPositive ? '+' : '-'}] ${finding.category}: ${finding.description} (${relativeDate(finding.createdAt, now)})`
    )
    .join('\n');
}

/** Standard chess move-pair phrasing for any ply — "the game start" for
 * ply 0, otherwise "White's/Black's move N". Shared by the coaching-plan
 * renderer and the coach context restructure's annotated-PGN/other-moves-
 * summary/current-move-block renderers (packages/prompts/src/episode-
 * context.ts) so they all describe a ply identically. */
export function describeMoveRef(ply: number): string {
  const ref = plyToMoveRef(ply);
  return ref.color === null ? 'the game start' : `${capitalize(ref.color)}'s move ${ref.moveNumber}`;
}

/**
 * prompts.md §2.2: numbered moments with a move-pair reference, kind,
 * question, and key line. Uses "White's/Black's move N" (standard PGN
 * terminology) rather than a bare ply — the model must later address this
 * same moment via show_position's {moveNumber, color}, so the reference it
 * reads here has to be the one it can hand back unchanged, not one it has
 * to convert.
 */
export function renderCoachingPlanBlock(plan: CoachingPlan): string {
  return plan.moments.map((moment, index) => `${index + 1}. ${renderMoment(moment)}`).join('\n');
}

function renderMoment(moment: CoachingPlan['moments'][number]): string {
  return `${describeMoveRef(moment.ply)} (${moment.kind}): "${moment.socraticQuestion}" Key line: ${moment.keyLine}`;
}

/** Coach context restructure design §5, layer 5: the backstage conversation
 * ledger, finally rendered into the live prompt (previously computed but
 * never injected). */
export function renderThreadsBlock(threads: Thread[]): string {
  if (threads.length === 0) return '(empty — no parked topics right now)';
  return threads.map(renderThreadLine).join('\n');
}

function renderThreadLine(thread: Thread): string {
  const hypothesis = thread.hypothesis ? ` (hypothesis: ${thread.hypothesis})` : '';
  return `- [${thread.status}] ${thread.topic}${hypothesis}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

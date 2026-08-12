import { moveRefToPly } from '@chess-coach/chess-analysis';
import type { z } from 'zod';
import type { CoachMessage } from '../../hooks/useCoachChat.js';
import { encodePositionDivider, sanForPly } from '../chat/positionDivider.js';
import type { SessionMessageSchema } from './sessionPageSchemas.js';

export const SESSION_START_MARKER = '[session_start]';

/** A persisted message's `content` is either the AI SDK's parts array or (for
 * plain user turns, e.g. the synthesized session-start marker) a bare string. */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: string; text: string } => {
        return typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text';
      })
      .map((part) => part.text)
      .join('');
  }
  return '';
}

interface ToolCallPart {
  type: 'tool-call';
  toolName: string;
  /** The AI SDK's current field name for a tool call's arguments. */
  input?: unknown;
  /** What the SDK called the same field before v7. `session_messages` is
   * append-only, so every session recorded before the upgrade still stores
   * its tool calls under this name and must keep resolving. */
  args?: unknown;
}

function isToolCallPart(part: unknown): part is ToolCallPart {
  return typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'tool-call';
}

function toolCallInput(part: ToolCallPart): unknown {
  return part.input ?? part.args;
}

/** Persisted show_position input is either the current {moveNumber, color}
 * shape, or the {ply} shape from before the move-number fix — old sessions'
 * history still contains the old shape, and must keep resolving to the
 * right position rather than NaN. */
function plyFromShowPositionArgs(args: unknown): number {
  const { ply, moveNumber, color } = args as { ply?: number; moveNumber?: number; color?: 'white' | 'black' | null };
  if (typeof ply === 'number') return ply;
  return moveRefToPly(moveNumber ?? 0, color ?? null);
}

/** design.md §5.3: a persisted show_position tool-call becomes a position
 * divider on reload too, matching the live-stream path in useCoachChat. */
export function showPositionPlies(content: unknown): number[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter(isToolCallPart)
    .filter((part) => part.toolName === 'show_position')
    .map((part) => plyFromShowPositionArgs(toolCallInput(part)));
}

export function toCoachMessages(
  messages: z.infer<typeof SessionMessageSchema>[],
  sanMoves: string[]
): CoachMessage[] {
  return messages
    .filter((message) => message.role !== 'tool')
    .flatMap((message): CoachMessage[] => {
      const role = message.role as 'user' | 'assistant';
      const text = extractText(message.content);
      const entries: CoachMessage[] = [];
      if (text.trim() !== '' && text !== SESSION_START_MARKER) {
        entries.push({ id: message.id, role, text });
      }
      if (role === 'assistant') {
        for (const ply of showPositionPlies(message.content)) {
          const san = sanForPly(sanMoves, ply);
          if (san) entries.push({ id: `${message.id}-divider-${ply}`, role, text: encodePositionDivider(ply, san) });
        }
      }
      return entries;
    });
}

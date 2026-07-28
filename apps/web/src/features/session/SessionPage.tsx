import { parsePgn } from '@chess-coach/chess-analysis';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { apiGet } from '../../api/client.js';
import { useCoachChat, type CoachMessage } from '../../hooks/useCoachChat.js';
import { useIsBoardSideBySide } from '../../hooks/useIsBoardSideBySide.js';
import { useWasmEngine } from '../../hooks/useWasmEngine.js';
import { CoachBoard } from '../board/CoachBoard.js';
import { ExplorePanel } from '../board/ExplorePanel.js';
import { MiniBoard } from '../board/MiniBoard.js';
import { MoveStrip } from '../board/MoveStrip.js';
import { ChatPane } from '../chat/ChatPane.js';
import { encodePositionDivider, sanForPly } from '../chat/positionDivider.js';
import { SessionSummaryCard } from '../chat/SessionSummaryCard.js';
import { SessionHeader } from './SessionHeader.js';
import { useSessionBoardState } from './useSessionBoardState.js';
import './SessionPage.css';

const UNDO_PILL_MS = 2000;
const SESSION_START_MARKER = '[session_start]';

const SessionMessageSchema = z.object({
  id: z.coerce.string(),
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.unknown()
});

const SessionDetailSchema = z.object({
  id: z.string(),
  gameId: z.string(),
  status: z.enum(['active', 'completed', 'paused_no_credits']),
  summary: z.string().nullable(),
  homework: z.string().nullable(),
  messages: z.array(SessionMessageSchema)
});

/** A persisted message's `content` is either the AI SDK's parts array or (for
 * plain user turns, e.g. the synthesized session-start marker) a bare string. */
function extractText(content: unknown): string {
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
  args: unknown;
}

function isToolCallPart(part: unknown): part is ToolCallPart {
  return typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'tool-call';
}

/** design.md §5.3: a persisted show_position tool-call becomes a position
 * divider on reload too, matching the live-stream path in useCoachChat. */
function showPositionPlies(content: unknown): number[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter(isToolCallPart)
    .filter((part) => part.toolName === 'show_position')
    .map((part) => (part.args as { ply: number }).ply);
}

function toCoachMessages(messages: z.infer<typeof SessionMessageSchema>[], sanMoves: string[]): CoachMessage[] {
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

const GameDetailSchema = z.object({
  id: z.string(),
  pgn: z.string(),
  userColor: z.enum(['white', 'black']),
  whiteName: z.string().nullable(),
  blackName: z.string().nullable(),
  result: z.string().nullable()
});

/** design.md §5: composes board + chat for an active coaching session.
 * Owns all fetching (AGENTS.md rule 7) — every child below is presentational. */
export function SessionPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const sessionId = id ?? '';
  const navigate = useNavigate();
  const isSideBySide = useIsBoardSideBySide();

  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: ({ signal }) => apiGet(`/api/sessions/${sessionId}`, SessionDetailSchema, signal),
    enabled: sessionId !== ''
  });

  const gameId = sessionQuery.data?.gameId;
  const gameQuery = useQuery({
    queryKey: ['game', gameId],
    queryFn: ({ signal }) => apiGet(`/api/games/${gameId}`, GameDetailSchema, signal),
    enabled: gameId !== undefined
  });

  const positions = gameQuery.data ? parsePgn(gameQuery.data.pgn).positions : [];
  const sanMoves = positions.filter((position) => position.moveSan !== null).map((position) => position.moveSan as string);

  const boardState = useSessionBoardState(positions);
  const engine = useWasmEngine();
  const initialMessages =
    sessionQuery.data && gameQuery.data ? toCoachMessages(sessionQuery.data.messages, sanMoves) : undefined;
  const chat = useCoachChat(sessionId, { onToolCall: boardState.handleToolCall, initialMessages, sanMoves });

  const [pendingMove, setPendingMove] = useState<{ san: string; fen: string } | null>(null);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (sessionQuery.isLoading || gameQuery.isLoading) return <p>Loading…</p>;
  if (sessionQuery.isError || !sessionQuery.data) return <p>Could not load this session.</p>;

  const session = sessionQuery.data;

  if (session.status === 'completed') {
    return (
      <SessionSummaryCard
        summary={session.summary ?? ''}
        homework={session.homework}
        onBackToGames={() => navigate('/games')}
        onViewProgress={() => navigate('/dashboard')}
      />
    );
  }

  function handleUserMove(san: string, fen: string): void {
    setPendingMove({ san, fen });
    pendingTimeoutRef.current = setTimeout(() => {
      void chat.sendMessage(`[board_move] I played ${san} (position now: ${fen})`);
      setPendingMove(null);
    }, UNDO_PILL_MS);
  }

  function handleUndoMove(): void {
    if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
    setPendingMove(null);
  }

  const orientation = gameQuery.data?.userColor ?? 'white';
  const showMiniBoard = !isSideBySide && boardState.isDocked;

  return (
    <div className="session-page">
      <SessionHeader
        whiteName={gameQuery.data?.whiteName ?? null}
        blackName={gameQuery.data?.blackName ?? null}
        result={gameQuery.data?.result ?? null}
        onBack={() => navigate('/games')}
      />
      <div className={isSideBySide ? 'session-body desktop' : 'session-body mobile'}>
        <div className="session-board-column">
          {showMiniBoard ? (
            <MiniBoard fen={boardState.fen} size={96} onExpand={boardState.expandDock} />
          ) : (
            <CoachBoard
              fen={boardState.fen}
              orientation={orientation}
              mode={boardState.mode}
              arrows={boardState.arrows}
              highlights={boardState.highlights}
              onUserMove={handleUserMove}
            />
          )}
          {pendingMove && (
            <p className="undo-pill">
              Sending {pendingMove.san}…{' '}
              <button type="button" onClick={handleUndoMove}>
                ↩︎ undo
              </button>
            </p>
          )}
          {boardState.mode === 'peek' && (
            <p className="peek-pill">
              exploring —{' '}
              <button type="button" onClick={boardState.backToCoach}>
                ⟲ back to coach
              </button>
            </p>
          )}
          <MoveStrip sanMoves={sanMoves} currentPly={boardState.ply} momentPlies={[]} onSelect={boardState.peekAt} />
          <ExplorePanel fen={boardState.fen} onEnterPeekMode={() => boardState.setMode('peek')} engine={engine} />
        </div>
        {session.status === 'paused_no_credits' ? (
          <div className="session-paused-card">
            <p>The session is saved. Add credits or your own API key to continue.</p>
            <button type="button" onClick={() => navigate('/settings')}>
              Add credits
            </button>
          </div>
        ) : (
          <ChatPane
            messages={chat.messages}
            activeToolName={chat.activeToolName}
            isThinking={chat.isThinking}
            onSend={(content) => void chat.sendMessage(content)}
            onScrollUp={boardState.collapseDock}
          />
        )}
      </div>
    </div>
  );
}

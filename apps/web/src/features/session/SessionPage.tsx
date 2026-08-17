import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useIsBoardSideBySide } from '../../hooks/useIsBoardSideBySide.js';
import { useIsDesktop } from '../../hooks/useIsDesktop.js';
import { DivergedLinePanel } from '../board/DivergedLinePanel.js';
import { MoveExplorer } from '../board/MoveExplorer.js';
import type { ArrowRef } from '../chat/arrowToken.js';
import { ChatPane } from '../chat/ChatPane.js';
import { encodeDivergedLine } from '../chat/divergedLine.js';
import type { HoverMove } from '../chat/MessageList.js';
import { encodePositionContext, sanForPly } from '../chat/positionDivider.js';
import { SessionSummaryCard } from '../chat/SessionSummaryCard.js';
import { MobileSessionBody } from './MobileSessionBody.js';
import { SessionBoardColumn } from './SessionBoardColumn.js';
import { SessionHeader } from './SessionHeader.js';
import { useMobileSessionView } from './useMobileSessionView.js';
import { useSessionPageData } from './useSessionPageData.js';
import './SessionPage.css';

/** design.md §5: composes board + chat for an active coaching session.
 * All fetching lives in useSessionPageData (AGENTS.md rule 7); this is
 * presentational — local UI state, a few small handlers, and the layout.
 * At/above 768px board and chat sit side by side; below it each owns a full
 * screen and MobileSessionBody switches between them. */
export function SessionPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const sessionId = id ?? '';
  const navigate = useNavigate();
  const isSideBySide = useIsBoardSideBySide();
  const isDesktop = useIsDesktop();

  const {
    sessionQuery,
    gameQuery,
    sanMoves,
    positions,
    boardState,
    divergedLine,
    currentRealPosition,
    peekAt,
    autoplayIntervalMs,
    setAutoplayIntervalMs,
    engine,
    chat,
    handleReset,
    handlePlayMoveCommitted
  } = useSessionPageData(sessionId);

  const [boardArrows, setBoardArrows] = useState<ArrowRef[]>([]);
  const [hoverMove, setHoverMove] = useState<HoverMove>(null);
  const mobileView = useMobileSessionView(chat.messages.length);

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

  if (session.status === 'abandoned') {
    return (
      <div className="session-summary-card">
        <p>This session was reset.</p>
        <button type="button" onClick={() => navigate('/games')}>
          Back to Games
        </button>
      </div>
    );
  }

  function handleSendMessage(content: string): void {
    if (divergedLine.line) {
      void chat.sendMessage(encodeDivergedLine(divergedLine.line, content));
      // The line stays active — the coach may continue the hypothetical.
      return;
    }
    if (boardState.mode === 'peek') {
      const san = sanForPly(sanMoves, boardState.ply) ?? '';
      void chat.sendMessage(encodePositionContext(boardState.ply, san, content));
      boardState.anchorHere();
      return;
    }
    void chat.sendMessage(content);
  }

  const orientation = gameQuery.data?.userColor ?? 'white';
  // Same fen SessionBoardColumn computes for the board itself — needed here
  // too so ChatPane can resolve move mentions against the position actually
  // on screen (design.md §5.3), and so the mobile peek shows it.
  const fen = divergedLine.fen ?? boardState.fen;

  const board = (
    <SessionBoardColumn
      boardState={boardState}
      divergedLine={divergedLine}
      currentRealPosition={currentRealPosition}
      orientation={orientation}
      sanMoves={sanMoves}
      positions={positions}
      classifiedMoves={gameQuery.data?.classifiedMoves}
      isDesktop={isDesktop}
      engine={engine}
      autoplayIntervalMs={autoplayIntervalMs}
      onChangeAutoplayInterval={setAutoplayIntervalMs}
      sendMessage={(content) => void chat.sendMessage(content)}
      onArrowsChange={setBoardArrows}
      hoverMove={hoverMove}
      sessionMode={session.mode}
      sessionId={sessionId}
      onPlayMoveCommitted={handlePlayMoveCommitted}
    />
  );

  const chatPanel =
    session.status === 'paused_no_credits' ? (
      <div className="session-paused-card">
        <p>The session is saved. Add credits or your own API key to continue.</p>
        <button type="button" onClick={() => navigate('/settings')}>
          Add credits
        </button>
      </div>
    ) : (
      <ChatPane
        sessionId={sessionId}
        messages={chat.messages}
        activeToolName={chat.activeToolName}
        isThinking={chat.isThinking}
        onSend={handleSendMessage}
        onSelectPly={peekAt}
        boardArrows={boardArrows}
        hasPendingLine={Boolean(divergedLine.line)}
        fen={fen}
        positions={positions}
        onHoverMove={setHoverMove}
      />
    );

  return (
    <div className="session-page">
      <SessionHeader
        whiteName={gameQuery.data?.whiteName ?? null}
        blackName={gameQuery.data?.blackName ?? null}
        result={gameQuery.data?.result ?? null}
        onBack={() => navigate('/games')}
        onReset={handleReset}
      />
      {isSideBySide ? (
        <div className="session-body desktop">
          {isDesktop &&
            (divergedLine.line ? (
              <DivergedLinePanel
                line={divergedLine.line}
                stepIndex={divergedLine.stepIndex}
                onSelectStep={divergedLine.previewStep}
                onExit={divergedLine.exit}
                autoplayIntervalMs={autoplayIntervalMs}
                onChangeAutoplayInterval={setAutoplayIntervalMs}
              />
            ) : (
              <MoveExplorer
                sanMoves={sanMoves}
                classifiedMoves={gameQuery.data?.classifiedMoves ?? []}
                positions={positions}
                currentPly={boardState.ply}
                onSelect={peekAt}
              />
            ))}
          {board}
          {chatPanel}
        </div>
      ) : (
        <MobileSessionBody
          board={board}
          chat={chatPanel}
          fen={fen}
          boardContext={{
            mode: boardState.mode,
            ply: boardState.ply,
            san: sanForPly(sanMoves, boardState.ply),
            hasDivergedLine: Boolean(divergedLine.line),
            isAnchoredPreMove: boardState.isAnchoredPreMove
          }}
          viewState={mobileView}
        />
      )}
    </div>
  );
}

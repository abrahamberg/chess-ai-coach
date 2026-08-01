import { PositionAnalysisSchema, type PositionAnalysis, type PositionFeatures } from '@chess-coach/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiPost } from '../../api/client.js';
import './PositionAnalysisPanel.css';

export interface PositionAnalysisPanelProps {
  fen: string;
  /** The student's showEngineAnalysis preference — off by default (design.md
   * principle 4). Query stays disabled (and nothing renders) until on. */
  enabled: boolean;
}

/**
 * Opt-in structured analysis panel — the one place in the app allowed to
 * show raw evaluations, principal variations, and tactical detail, gated
 * behind the student's own preference. Separate from ExplorePanel, which
 * stays word-only for everyone and runs a lightweight client-side WASM
 * engine; this calls the server-side Stockfish service for a deeper,
 * consistent breakdown. Presentational: owns only its own fetch (AGENTS.md
 * rule 7 — the parent owns which fen/whether it's enabled).
 */
export function PositionAnalysisPanel({ fen, enabled }: PositionAnalysisPanelProps): ReactNode {
  const query = useQuery({
    queryKey: ['position-analysis', fen],
    queryFn: () => apiPost('/api/positions/analyze', { fen }, PositionAnalysisSchema),
    enabled: enabled && fen.length > 0
  });

  if (!enabled) return null;
  if (query.isLoading) return <div className="position-analysis-panel">Analyzing…</div>;
  if (query.isError || !query.data) return <div className="position-analysis-panel">Analysis unavailable.</div>;

  return (
    <div className="position-analysis-panel">
      <SummarySection analysis={query.data} />
      <FeatureList title="Hanging pieces" items={query.data.features.hangingPieces.map(describeAttackedPiece)} />
      <FeatureList
        title="Under-defended pieces"
        items={query.data.features.underDefendedPieces.map(describeAttackedPiece)}
      />
      <FeatureList title="Forks" items={query.data.features.forks.map(describeFork)} />
      <FeatureList
        title="Capture opportunities"
        items={query.data.features.captureOpportunities.filter((c) => c.favorable).map(describeCapture)}
      />
      <PawnStructureSection features={query.data.features} />
      <MobilitySection features={query.data.features} />
    </div>
  );
}

function SummarySection({ analysis }: { analysis: PositionAnalysis }): ReactNode {
  const evalText = analysis.eval.mateIn !== null ? `mate in ${Math.abs(analysis.eval.mateIn)}` : formatCp(analysis.eval.cp);
  return (
    <div className="position-analysis-summary">
      <p className="position-analysis-eval">
        {evalText} · best: {analysis.bestMove ?? '—'}
      </p>
      <p className="position-analysis-board-state">
        {analysis.features.turn} to move{analysis.features.boardState !== 'none' ? ` · ${analysis.features.boardState}` : ''}
      </p>
      {analysis.lines.map((line) => (
        <p key={line.moveUci} className="position-analysis-line">
          {line.pvSan.join(' ')}
        </p>
      ))}
    </div>
  );
}

function PawnStructureSection({ features }: { features: PositionFeatures }): ReactNode {
  const items = [
    features.openFiles.length > 0 ? `open files: ${features.openFiles.join(', ')}` : null,
    ...features.semiOpenFiles.map((f) => `${f.file}-file semi-open for ${f.openFor}`),
    ...features.doubledPawns.map((p) => `doubled ${p.color} pawns on ${p.file} (${p.count})`),
    ...features.isolatedPawns.map((p) => `isolated ${p.color} pawn on ${p.square}`),
    ...features.passedPawns.map((p) => `passed ${p.color} pawn on ${p.square}`)
  ].filter((item): item is string => item !== null);
  return <FeatureList title="Pawn structure" items={items} />;
}

function MobilitySection({ features }: { features: PositionFeatures }): ReactNode {
  return (
    <div className="position-analysis-section">
      <h4>Mobility / center control</h4>
      <p>
        mobility — white: {features.mobility.white}, black: {features.mobility.black}
      </p>
      <p>
        center control — white: {features.centerControlScore.white}, black: {features.centerControlScore.black}
      </p>
    </div>
  );
}

function FeatureList({ title, items }: { title: string; items: string[] }): ReactNode {
  if (items.length === 0) return null;
  return (
    <div className="position-analysis-section">
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function describeAttackedPiece(piece: PositionFeatures['hangingPieces'][number]): string {
  return `${piece.color} ${piece.piece} on ${piece.square} — ${piece.attackers} attacker(s), ${piece.defenders} defender(s)`;
}

function describeFork(fork: PositionFeatures['forks'][number]): string {
  return `${fork.piece} on ${fork.square} forks ${fork.forkedSquares.join(', ')}`;
}

function describeCapture(capture: PositionFeatures['captureOpportunities'][number]): string {
  return `${capture.moveSan} wins the ${capture.capturedPiece} on ${capture.to}`;
}

function formatCp(cp: number | null): string {
  if (cp === null) return 'equal';
  const pawns = (cp / 100).toFixed(2);
  return cp > 0 ? `+${pawns}` : pawns;
}

import type { MouseEvent, ReactNode } from 'react';
import type { ClassifiedMoveDto } from '@chess-coach/shared';
import './GameEvalChart.css';

export interface GameEvalChartProps {
  classifiedMoves: ClassifiedMoveDto[];
  currentPly: number;
  onSelect: (ply: number) => void;
}

const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 32;
/** Visual clamp only (evalAfterCp itself isn't globally clamped like this —
 * only mate scores are, to +-1000cp in classify.ts) — keeps one lopsided
 * swing from squashing the rest of the game's curve flat. */
const CLAMP_CP = 800;

/** Hand-rolled SVG area chart of the whole game's evaluation swing (design
 * convention matches TrendChart.tsx: no charting library, plain divs/SVG).
 * Docked at the bottom of MoveExplorer. Presentational only (AGENTS.md rule
 * 7) — classifiedMoves/currentPly come from the parent, which already has
 * them loaded with the game; clicking anywhere seeks via onSelect, same
 * callback the move list itself uses. */
export function GameEvalChart({ classifiedMoves, currentPly, onSelect }: GameEvalChartProps): ReactNode {
  if (classifiedMoves.length === 0) {
    return <div className="game-eval-chart game-eval-chart--empty">Evaluation not available yet.</div>;
  }

  const totalPlies = classifiedMoves.length;
  const points = [{ ply: 0, cp: 0 }, ...classifiedMoves.map((move) => ({ ply: move.ply, cp: move.evalAfterCp }))];
  const toX = (ply: number) => (ply / totalPlies) * VIEW_WIDTH;
  const toY = (cp: number) => {
    const clamped = Math.max(-CLAMP_CP, Math.min(CLAMP_CP, cp));
    return VIEW_HEIGHT / 2 - (clamped / CLAMP_CP) * (VIEW_HEIGHT / 2);
  };

  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(point.ply)} ${toY(point.cp)}`).join(' ');
  const areaPath = `${linePath} L ${toX(totalPlies)} ${VIEW_HEIGHT / 2} L ${toX(0)} ${VIEW_HEIGHT / 2} Z`;

  function handleClick(event: MouseEvent<SVGSVGElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    const ply = Math.round(Math.min(1, Math.max(0, fraction)) * totalPlies);
    onSelect(ply);
  }

  return (
    <div className="game-eval-chart">
      <svg
        className="game-eval-chart__svg"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        onClick={handleClick}
        role="img"
        aria-label="Evaluation across the whole game — click to jump to a move"
      >
        <defs>
          {/* White/black fill split at the zero line — one area path, two
           * clipped copies, rather than a per-segment gradient. */}
          <clipPath id="game-eval-chart-top" clipPathUnits="userSpaceOnUse">
            <rect x={0} y={0} width={VIEW_WIDTH} height={VIEW_HEIGHT / 2} />
          </clipPath>
          <clipPath id="game-eval-chart-bottom" clipPathUnits="userSpaceOnUse">
            <rect x={0} y={VIEW_HEIGHT / 2} width={VIEW_WIDTH} height={VIEW_HEIGHT / 2} />
          </clipPath>
        </defs>
        <line x1={0} y1={VIEW_HEIGHT / 2} x2={VIEW_WIDTH} y2={VIEW_HEIGHT / 2} className="game-eval-chart__zero-line" />
        <path
          d={areaPath}
          clipPath="url(#game-eval-chart-top)"
          className="game-eval-chart__area game-eval-chart__area--white"
        />
        <path
          d={areaPath}
          clipPath="url(#game-eval-chart-bottom)"
          className="game-eval-chart__area game-eval-chart__area--black"
        />
        <path d={linePath} className="game-eval-chart__line" />
        <line
          x1={toX(currentPly)}
          y1={0}
          x2={toX(currentPly)}
          y2={VIEW_HEIGHT}
          className="game-eval-chart__cursor"
        />
      </svg>
    </div>
  );
}

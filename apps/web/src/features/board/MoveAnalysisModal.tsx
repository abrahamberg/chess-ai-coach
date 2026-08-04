import type { ReactNode } from 'react';
import { JsonTreeView } from '../../components/JsonTreeView.js';
import { Modal } from '../../components/Modal.js';
import { usePositionAnalysis } from './usePositionAnalysis.js';

export interface MoveAnalysisModalProps {
  fen: string;
  moveLabel: string;
  onClose: () => void;
}

/** Opened via right-click (desktop) / long-press (mobile) on a move in the
 * move list — shows that position's saved engine analysis as a collapsible,
 * color-coded JSON tree. Available regardless of the student's
 * showEngineAnalysis chat preference: that setting only gates what the
 * coach volunteers in conversation, not this separate, explicitly-opened
 * inspector. */
export function MoveAnalysisModal({ fen, moveLabel, onClose }: MoveAnalysisModalProps): ReactNode {
  const { data, isLoading, isError } = usePositionAnalysis(fen);

  return (
    <Modal title={`Analysis — ${moveLabel}`} onClose={onClose}>
      {isLoading && <p>Loading…</p>}
      {isError && <p>Could not load analysis for this position.</p>}
      {data && <JsonTreeView data={data} />}
    </Modal>
  );
}

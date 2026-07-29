import { describe, expect, test } from 'vitest';
import {
  annotateBoardParameters,
  endSessionParameters,
  getEngineAnalysisParameters,
  getUserProfileParameters,
  recordFindingParameters,
  proposeFocusAreaUpdateParameters,
  showPositionParameters,
  updateThreadsParameters
} from './tools.js';

describe('coach agent tool parameter schemas (architecture §7.1)', () => {
  test('show_position: { moveNumber, color } — never a bare ply, which is not standard PGN terminology and is what caused the coach to compute the wrong position', () => {
    expect(showPositionParameters.safeParse({ moveNumber: 2, color: 'white' }).success).toBe(true);
    expect(showPositionParameters.safeParse({ moveNumber: 0, color: 'white' }).success).toBe(false);
    expect(showPositionParameters.safeParse({ moveNumber: 2, color: 'purple' }).success).toBe(false);
    expect(showPositionParameters.safeParse({ ply: 12 }).success).toBe(false);
  });

  test('show_position: moveNumber 0 with color null means the game start (ply 0)', () => {
    expect(showPositionParameters.safeParse({ moveNumber: 0, color: null }).success).toBe(true);
  });

  test('annotate_board: { arrows, highlights }', () => {
    const valid = {
      arrows: [{ from: 'e2', to: 'e4', color: 'green' }],
      highlights: [{ square: 'd5', color: 'red' }]
    };
    expect(annotateBoardParameters.safeParse(valid).success).toBe(true);
    expect(annotateBoardParameters.safeParse({ arrows: [], highlights: [] }).success).toBe(true);
  });

  test('get_engine_analysis: { fen, question }', () => {
    expect(
      getEngineAnalysisParameters.safeParse({ fen: 'startpos', question: 'is Nxd5 sound?' }).success
    ).toBe(true);
    expect(getEngineAnalysisParameters.safeParse({ fen: 'startpos' }).success).toBe(false);
  });

  test('get_user_profile: {}', () => {
    expect(getUserProfileParameters.safeParse({}).success).toBe(true);
  });

  test('record_finding: Finding schema, rejects unknown category', () => {
    const valid = {
      category: 'hanging_piece',
      severity: 'significant',
      ply: 12,
      description: 'x',
      isPositive: false
    };
    expect(recordFindingParameters.safeParse(valid).success).toBe(true);
    expect(recordFindingParameters.safeParse({ ...valid, category: 'laziness' }).success).toBe(false);
  });

  test('propose_focus_area_update: FocusAreaUpdate schema', () => {
    const valid = { category: 'hanging_piece', action: 'create', note: 'x' };
    expect(proposeFocusAreaUpdateParameters.safeParse(valid).success).toBe(true);
    expect(proposeFocusAreaUpdateParameters.safeParse({ ...valid, action: 'delete' }).success).toBe(false);
  });

  test('update_threads: { threads }', () => {
    expect(updateThreadsParameters.safeParse({ threads: [] }).success).toBe(true);
  });

  test('end_session: { summary, homework }', () => {
    expect(endSessionParameters.safeParse({ summary: 'x', homework: null }).success).toBe(true);
    expect(endSessionParameters.safeParse({ summary: 'x', homework: 'study rook endgames' }).success).toBe(
      true
    );
    expect(endSessionParameters.safeParse({ summary: 'x' }).success).toBe(false);
  });
});

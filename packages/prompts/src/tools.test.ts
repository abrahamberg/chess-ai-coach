import { describe, expect, test } from 'vitest';
import {
  annotateBoardParameters,
  checkPositionParameters,
  COACH_TOOL_SPECS,
  coachToolDescription,
  endSessionParameters,
  expectMoveParameters,
  getEngineAnalysisParameters,
  getUserProfileParameters,
  hypotheticalLineParameters,
  recordFindingParameters,
  proposeFocusAreaUpdateParameters,
  recallMoveParameters,
  recordMoveNoteParameters,
  revealMoveParameters,
  showPositionParameters,
  updateThreadsParameters
} from './tools.js';

describe('coach agent tool parameter schemas (architecture §7.1)', () => {
  test('show_position: { moveNumber, color, intent } — never a bare ply, which is not standard PGN terminology and is what caused the coach to compute the wrong position', () => {
    expect(showPositionParameters.safeParse({ moveNumber: 2, color: 'white', intent: 'subject' }).success).toBe(true);
    expect(showPositionParameters.safeParse({ moveNumber: 0, color: 'white', intent: 'subject' }).success).toBe(false);
    expect(showPositionParameters.safeParse({ moveNumber: 2, color: 'purple', intent: 'subject' }).success).toBe(
      false
    );
    expect(showPositionParameters.safeParse({ ply: 12, intent: 'subject' }).success).toBe(false);
  });

  test('show_position: moveNumber 0 with color null means the game start (ply 0)', () => {
    expect(showPositionParameters.safeParse({ moveNumber: 0, color: null, intent: 'subject' }).success).toBe(true);
  });

  test('show_position: intent is required and must be "flashback" or "subject"', () => {
    expect(showPositionParameters.safeParse({ moveNumber: 2, color: 'white' }).success).toBe(false);
    expect(showPositionParameters.safeParse({ moveNumber: 2, color: 'white', intent: 'flashback' }).success).toBe(
      true
    );
    expect(showPositionParameters.safeParse({ moveNumber: 2, color: 'white', intent: 'glance' }).success).toBe(
      false
    );
  });

  test('check_position: same address shape as show_position, { moveNumber, color }', () => {
    expect(checkPositionParameters.safeParse({ moveNumber: 2, color: 'white' }).success).toBe(true);
    expect(checkPositionParameters.safeParse({ moveNumber: 0, color: null }).success).toBe(true);
    expect(checkPositionParameters.safeParse({ moveNumber: 0, color: 'white' }).success).toBe(false);
  });

  test('annotate_board: { arrows, highlights }', () => {
    const valid = {
      arrows: [{ from: 'e2', to: 'e4', color: 'green' }],
      highlights: [{ square: 'd5', color: 'red' }]
    };
    expect(annotateBoardParameters.safeParse(valid).success).toBe(true);
    expect(annotateBoardParameters.safeParse({ arrows: [], highlights: [] }).success).toBe(true);
  });

  test('get_engine_analysis: { fen }', () => {
    expect(getEngineAnalysisParameters.safeParse({ fen: 'startpos' }).success).toBe(true);
    expect(getEngineAnalysisParameters.safeParse({}).success).toBe(false);
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

  test('expect_move: {}', () => {
    expect(expectMoveParameters.safeParse({}).success).toBe(true);
  });

  test('hypothetical_line: { moves }, a non-empty list of SAN strings, no { moveNumber, color } address (the base position is implicit)', () => {
    expect(hypotheticalLineParameters.safeParse({ moves: ['a4'] }).success).toBe(true);
    expect(hypotheticalLineParameters.safeParse({ moves: ['a4', 'Nf6'] }).success).toBe(true);
    expect(hypotheticalLineParameters.safeParse({ moves: [] }).success).toBe(false);
    expect(hypotheticalLineParameters.safeParse({ moves: [''] }).success).toBe(false);
    expect(hypotheticalLineParameters.safeParse({}).success).toBe(false);
  });

  test('reveal_move: { mode: "preview" | "full" }, no { moveNumber, color } address (acts on whatever is currently anchored pre-move)', () => {
    expect(revealMoveParameters.safeParse({ mode: 'preview' }).success).toBe(true);
    expect(revealMoveParameters.safeParse({ mode: 'full' }).success).toBe(true);
    expect(revealMoveParameters.safeParse({ mode: 'partial' }).success).toBe(false);
    expect(revealMoveParameters.safeParse({}).success).toBe(false);
  });
});

describe('record_move_note: { moveNumber, color, note } — same address as show_position, never a bare ply (final review #1)', () => {
  test('accepts a { moveNumber, color } address and a short note', () => {
    expect(
      recordMoveNoteParameters.safeParse({ moveNumber: 9, color: 'black', note: 'missed Rxd5, assigned as homework' })
        .success
    ).toBe(true);
  });

  test('rejects a bare ply, a negative moveNumber, and an empty note', () => {
    expect(recordMoveNoteParameters.safeParse({ ply: 18, note: 'x' }).success).toBe(false);
    expect(recordMoveNoteParameters.safeParse({ moveNumber: -1, color: 'white', note: 'x' }).success).toBe(false);
    expect(recordMoveNoteParameters.safeParse({ moveNumber: 9, color: 'black', note: '' }).success).toBe(false);
  });

  test('moveNumber 0 requires color null, same rule as show_position', () => {
    expect(recordMoveNoteParameters.safeParse({ moveNumber: 0, color: 'white', note: 'x' }).success).toBe(false);
    expect(recordMoveNoteParameters.safeParse({ moveNumber: 0, color: null, note: 'x' }).success).toBe(true);
  });
});

describe('recall_move: { moveNumber, color } — same address as show_position, never a bare ply (final review #1)', () => {
  test('accepts a { moveNumber, color } address', () => {
    expect(recallMoveParameters.safeParse({ moveNumber: 11, color: 'black' }).success).toBe(true);
  });

  test('rejects a bare ply and a missing address', () => {
    expect(recallMoveParameters.safeParse({ ply: 22 }).success).toBe(false);
    expect(recallMoveParameters.safeParse({}).success).toBe(false);
  });
});

describe('COACH_TOOL_SPECS / coachToolDescription — single source of truth for tool descriptions', () => {
  const EXPECTED_NAMES = [
    'show_position',
    'reveal_move',
    'check_position',
    'annotate_board',
    'expect_move',
    'hypothetical_line',
    'get_engine_analysis',
    'get_user_profile',
    'record_finding',
    'propose_focus_area_update',
    'update_threads',
    'record_move_note',
    'recall_move',
    'end_session'
  ];

  test('has exactly the coach agent\'s 14 tools, each with a unique name and a non-empty description', () => {
    expect(COACH_TOOL_SPECS.map((spec) => spec.name)).toEqual(EXPECTED_NAMES);
    for (const spec of COACH_TOOL_SPECS) {
      expect(spec.description.length).toBeGreaterThan(0);
    }
  });

  test('coachToolDescription returns the matching spec\'s description', () => {
    expect(coachToolDescription('show_position')).toBe(
      COACH_TOOL_SPECS.find((spec) => spec.name === 'show_position')?.description
    );
  });

  test('coachToolDescription throws on an unregistered tool name', () => {
    expect(() => coachToolDescription('not_a_real_tool')).toThrow(/not_a_real_tool/);
  });
});

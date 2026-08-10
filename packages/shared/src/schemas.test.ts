import { describe, expect, test } from 'vitest';
import {
  AnalyzeGameRequestSchema,
  AnalyzePositionRequestSchema,
  ClassifiedMoveSchema,
  EngineEvalSchema,
  PositionAnalysisSchema
} from './analysis.js';
import { CoachingPlanSchema, type CoachingPlan } from './coaching-plan.js';
import { CreditPackSchema } from './credits.js';
import { DashboardResponseSchema } from './dashboard.js';
import { FindingSchema } from './finding.js';
import { ImportGameRequestSchema, ImportGameResponseSchema } from './game.js';
import { LlmProviderSchema, SavedLlmProvidersResponseSchema, SetLlmKeyRequestSchema } from './llm.js';
import {
  CreateSessionRequestSchema,
  PostSessionMessageRequestSchema,
  SessionOutcomeSchema,
  ThreadSchema
} from './session.js';
import { UpdateUserProfileRequestSchema, UserProfileSchema } from './user.js';

const validEngineEval = {
  ply: 12,
  fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  depth: 16,
  lines: [
    { moveUci: 'f1b5', moveSan: 'Bb5', cp: 35, mateIn: null },
    { moveUci: 'b1c3', moveSan: 'Nc3', cp: 28, mateIn: null }
  ]
};

function validPlanFixture(): CoachingPlan {
  return {
    gameSummary: 'Sharp Italian where the student lost the thread in the middlegame.',
    openingNote: 'Opening was fine through move 8.',
    themes: ['calculation_error', 'king_safety'],
    connectionToHistory: 'Second game in a row with a delayed castle.',
    moments: [
      {
        ply: 23,
        kind: 'user_mistake',
        category: 'king_safety',
        whatHappened: 'Pushed g4 in front of the uncastled king, eval swung -1.8.',
        socraticQuestion: 'Before pushing this pawn, where is your king going to live?',
        keyLine: 'O-O Re8 d3 h6',
        revealDepthPlies: 6
      }
    ]
  };
}

describe('EngineEvalSchema', () => {
  test('accepts a valid eval', () => {
    expect(EngineEvalSchema.safeParse(validEngineEval).success).toBe(true);
  });
  test('accepts mate scores with null cp', () => {
    const mate = {
      ...validEngineEval,
      lines: [{ moveUci: 'd8h4', moveSan: 'Qh4#', cp: null, mateIn: 1 }]
    };
    expect(EngineEvalSchema.safeParse(mate).success).toBe(true);
  });
  // Regression: browser-mode analysis of any game ending in mate used to fail
  // here, since the tunnel backend is the only path that parses this schema.
  test('accepts zero lines for a terminal position (checkmate/stalemate has no legal moves)', () => {
    const terminal = { ...validEngineEval, lines: [] };
    expect(EngineEvalSchema.safeParse(terminal).success).toBe(true);
  });
  test('rejects a line missing moveSan', () => {
    const bad = { ...validEngineEval, lines: [{ moveUci: 'e2e4', cp: 10, mateIn: null }] };
    expect(EngineEvalSchema.safeParse(bad).success).toBe(false);
  });
});

describe('ClassifiedMoveSchema', () => {
  const validMove = {
    ply: 4,
    moveSan: 'Qxf7#',
    mover: 'white',
    isUserMove: true,
    cpLoss: 0,
    quality: 'brilliant',
    bestLineSan: ['Qxf7#'],
    evalAfterCp: 1000,
    hangsPiece: false
  };
  test('accepts a valid classified move', () => {
    expect(ClassifiedMoveSchema.safeParse(validMove).success).toBe(true);
  });
  test('accepts every MOVE_QUALITIES tier', () => {
    for (const quality of ['brilliant', 'best', 'good', 'interesting', 'dubious', 'mistake', 'miss', 'blunder']) {
      expect(ClassifiedMoveSchema.safeParse({ ...validMove, quality }).success).toBe(true);
    }
  });
  test('rejects an unknown quality tier (e.g. the old "inaccuracy" name)', () => {
    expect(ClassifiedMoveSchema.safeParse({ ...validMove, quality: 'inaccuracy' }).success).toBe(false);
  });
  test('defaults hangsPiece to false when missing (backward compatibility with pre-branch persisted games)', () => {
    const { hangsPiece, ...withoutHangsPiece } = validMove;
    const result = ClassifiedMoveSchema.safeParse(withoutHangsPiece);
    expect(result.success).toBe(true);
    expect(result.data?.hangsPiece).toBe(false);
  });
});

describe('AnalyzeGameRequestSchema', () => {
  test('accepts fens with optional depth and multiPv', () => {
    const body = { fens: ['startpos-fen', 'next-fen'], depth: 12, multiPv: 3 };
    expect(AnalyzeGameRequestSchema.safeParse(body).success).toBe(true);
  });
  test('accepts fens with depth/multiPv omitted', () => {
    expect(AnalyzeGameRequestSchema.safeParse({ fens: ['startpos-fen'] }).success).toBe(true);
  });
  test('rejects an empty fens array', () => {
    expect(AnalyzeGameRequestSchema.safeParse({ fens: [] }).success).toBe(false);
  });
  test('rejects a non-positive depth', () => {
    expect(AnalyzeGameRequestSchema.safeParse({ fens: ['f'], depth: 0 }).success).toBe(false);
  });
});

describe('AnalyzePositionRequestSchema', () => {
  test('accepts a fen with optional depth and multiPv', () => {
    const body = { fen: 'startpos-fen', depth: 12, multiPv: 2 };
    expect(AnalyzePositionRequestSchema.safeParse(body).success).toBe(true);
  });
  test('rejects a missing fen', () => {
    expect(AnalyzePositionRequestSchema.safeParse({ depth: 12 }).success).toBe(false);
  });
});

function validPositionFeaturesFixture() {
  return {
    turn: 'white',
    boardState: 'none',
    availableMoves: ['Nf3', 'e4'],
    mobility: { white: 20, black: 20 },
    controlledSquares: [{ square: 'g1', piece: 'n', color: 'white', squares: ['f3', 'h3'] }],
    piecesUnderAttack: [],
    hangingPieces: [],
    underDefendedPieces: [],
    overloadedDefenders: [],
    centerControlScore: { white: 2, black: 2 },
    openFiles: ['a', 'h'],
    semiOpenFiles: [{ file: 'c', openFor: 'black' }],
    doubledPawns: [],
    isolatedPawns: [],
    passedPawns: [],
    targetsAttacked: [],
    forks: [],
    captureOpportunities: []
  };
}

function validPositionAnalysisFixture() {
  return {
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    depth: 16,
    multiPv: 2,
    bestMove: 'Nf3',
    eval: { cp: 20, mateIn: null },
    lines: [
      { moveUci: 'g1f3', moveSan: 'Nf3', pvSan: ['Nf3', 'd5', 'd4'], cp: 20, mateIn: null },
      { moveUci: 'e2e4', moveSan: 'e4', pvSan: ['e4', 'e5'], cp: 18, mateIn: null }
    ],
    features: validPositionFeaturesFixture()
  };
}

describe('PositionAnalysisSchema', () => {
  test('accepts a valid rich position analysis', () => {
    const result = PositionAnalysisSchema.safeParse(validPositionAnalysisFixture());
    expect(result.success).toBe(true);
  });
  test('accepts a mate eval with null cp', () => {
    const mate = { ...validPositionAnalysisFixture(), eval: { cp: null, mateIn: 3 } };
    expect(PositionAnalysisSchema.safeParse(mate).success).toBe(true);
  });
  test('accepts bestMove: null (no legal moves)', () => {
    const noMoves = { ...validPositionAnalysisFixture(), bestMove: null };
    expect(PositionAnalysisSchema.safeParse(noMoves).success).toBe(true);
  });
  test('rejects a line missing pvSan', () => {
    const bad = validPositionAnalysisFixture();
    bad.lines = [{ moveUci: 'g1f3', moveSan: 'Nf3', cp: 20, mateIn: null } as unknown as (typeof bad.lines)[number]];
    expect(PositionAnalysisSchema.safeParse(bad).success).toBe(false);
  });
  test('rejects an unknown piece symbol in features', () => {
    const bad = validPositionAnalysisFixture();
    bad.features.controlledSquares = [{ square: 'g1', piece: 'x', color: 'white', squares: [] }];
    expect(PositionAnalysisSchema.safeParse(bad).success).toBe(false);
  });
  test('rejects an unknown boardState', () => {
    const bad = validPositionAnalysisFixture();
    bad.features.boardState = 'draw';
    expect(PositionAnalysisSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CoachingPlanSchema', () => {
  test('accepts a valid plan', () => {
    expect(CoachingPlanSchema.safeParse(validPlanFixture()).success).toBe(true);
  });
  test('rejects unknown category', () => {
    const plan = validPlanFixture();
    // @ts-expect-error deliberately invalid
    plan.moments[0].category = 'laziness';
    expect(CoachingPlanSchema.safeParse(plan).success).toBe(false);
  });
  test('rejects more than 8 moments', () => {
    const plan = validPlanFixture();
    const moment = plan.moments[0];
    if (!moment) throw new Error('fixture broken');
    plan.moments = Array.from({ length: 9 }, () => ({ ...moment }));
    expect(CoachingPlanSchema.safeParse(plan).success).toBe(false);
  });
  test('rejects empty moments', () => {
    const plan = { ...validPlanFixture(), moments: [] };
    expect(CoachingPlanSchema.safeParse(plan).success).toBe(false);
  });
  test('rejects more than 3 themes', () => {
    const plan = {
      ...validPlanFixture(),
      themes: ['no_plan', 'king_safety', 'passive_play', 'missed_tactic']
    };
    expect(CoachingPlanSchema.safeParse(plan).success).toBe(false);
  });
});

describe('FindingSchema', () => {
  const valid = {
    category: 'calculation_error',
    severity: 'significant',
    ply: 23,
    description: 'Stops calculating after the first capture in forcing lines.',
    isPositive: false
  };
  test('accepts a valid finding', () => {
    expect(FindingSchema.safeParse(valid).success).toBe(true);
  });
  test('accepts null ply (session-level observation)', () => {
    expect(FindingSchema.safeParse({ ...valid, ply: null }).success).toBe(true);
  });
  test('rejects invalid severity', () => {
    expect(FindingSchema.safeParse({ ...valid, severity: 'huge' }).success).toBe(false);
  });
});

describe('SessionOutcomeSchema', () => {
  test('accepts a valid outcome and rejects a bad focus-area action', () => {
    const outcome = {
      sessionSummary: 'You calculated the critical line well once prompted.',
      homework: 'Blunder-check every move in your next two games.',
      findings: [],
      focusAreaUpdates: [
        { category: 'calculation_error', action: 'progress', note: 'Found the refutation unprompted.' }
      ]
    };
    expect(SessionOutcomeSchema.safeParse(outcome).success).toBe(true);
    outcome.focusAreaUpdates[0]!.action = 'delete';
    expect(SessionOutcomeSchema.safeParse(outcome).success).toBe(false);
  });
});

describe('ThreadSchema', () => {
  const valid = {
    id: 1,
    topic: 'branch 14.Nxd5',
    status: 'parked',
    hypothesis: 'stops calculating after first capture',
    anchorPly: 27,
    anchorFen: null
  };
  test('accepts a valid thread', () => {
    expect(ThreadSchema.safeParse(valid).success).toBe(true);
  });
  test('rejects invalid status', () => {
    expect(ThreadSchema.safeParse({ ...valid, status: 'open' }).success).toBe(false);
  });
});

describe('CreateSessionRequestSchema', () => {
  test('accepts a gameId', () => {
    expect(CreateSessionRequestSchema.safeParse({ gameId: 'abc' }).success).toBe(true);
  });
  test('rejects a missing gameId', () => {
    expect(CreateSessionRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('PostSessionMessageRequestSchema', () => {
  test('accepts content only', () => {
    expect(PostSessionMessageRequestSchema.safeParse({ content: 'hello' }).success).toBe(true);
  });
  test('accepts a clientToolResult only', () => {
    const body = { clientToolResult: { toolCallId: '1', toolName: 'show_position', result: { ply: 4 } } };
    expect(PostSessionMessageRequestSchema.safeParse(body).success).toBe(true);
  });
  test('accepts an empty body — resumes the turn on whatever is already pending in history (e.g. session kickoff)', () => {
    expect(PostSessionMessageRequestSchema.safeParse({}).success).toBe(true);
  });
});

describe('ImportGameRequestSchema', () => {
  test('accepts paste without userColor', () => {
    const req = { pgn: '1. e4 e5', source: 'paste' };
    expect(ImportGameRequestSchema.safeParse(req).success).toBe(true);
  });
  test('rejects empty pgn and unknown source', () => {
    expect(ImportGameRequestSchema.safeParse({ pgn: '', source: 'paste' }).success).toBe(false);
    expect(ImportGameRequestSchema.safeParse({ pgn: '1. e4', source: 'email' }).success).toBe(false);
  });
});

describe('ImportGameResponseSchema', () => {
  test('accepts a gameId/analysisId pair', () => {
    const res = { gameId: 'g1', analysisId: 'a1' };
    expect(ImportGameResponseSchema.safeParse(res).success).toBe(true);
  });
  test('rejects a missing analysisId', () => {
    expect(ImportGameResponseSchema.safeParse({ gameId: 'g1' }).success).toBe(false);
  });
});

describe('UserProfileSchema', () => {
  test('accepts a valid profile', () => {
    const profile = {
      id: '7d9f2a44-9a5f-4f6e-b1a1-0a4c1e2d3f4b',
      email: 'student@example.com',
      displayName: 'daniel',
      ratingBand: 'club',
      lichessUsername: null,
      chesscomUsername: 'daniel_c',
      selfAssessment: null,
      engineMode: 'native',
      creditBalance: 100
    };
    expect(UserProfileSchema.safeParse(profile).success).toBe(true);
  });
  test('rejects unknown rating band', () => {
    expect(
      UserProfileSchema.safeParse({
        id: '7d9f2a44-9a5f-4f6e-b1a1-0a4c1e2d3f4b',
        email: 'student@example.com',
        displayName: 'daniel',
        ratingBand: 'grandmaster',
        lichessUsername: null,
        chesscomUsername: null,
        selfAssessment: null,
        creditBalance: 0
      }).success
    ).toBe(false);
  });
});

describe('UpdateUserProfileRequestSchema', () => {
  test('accepts a partial patch', () => {
    expect(UpdateUserProfileRequestSchema.safeParse({ ratingBand: 'advanced' }).success).toBe(true);
  });
  test('accepts an empty patch', () => {
    expect(UpdateUserProfileRequestSchema.safeParse({}).success).toBe(true);
  });
  test('rejects a rating band outside RATING_BANDS', () => {
    expect(UpdateUserProfileRequestSchema.safeParse({ ratingBand: 'grandmaster' }).success).toBe(false);
  });
  test('accepts nullable lichessUsername/chesscomUsername/selfAssessment', () => {
    const patch = { lichessUsername: null, chesscomUsername: null, selfAssessment: null };
    expect(UpdateUserProfileRequestSchema.safeParse(patch).success).toBe(true);
  });
});

describe('LlmProviderSchema / SetLlmKeyRequestSchema', () => {
  test('accepts the 2 providers, rejects others', () => {
    expect(LlmProviderSchema.safeParse('anthropic').success).toBe(true);
    expect(LlmProviderSchema.safeParse('openai').success).toBe(true);
    expect(LlmProviderSchema.safeParse('cohere').success).toBe(false);
  });
  test('accepts a non-empty apiKey, rejects empty', () => {
    expect(SetLlmKeyRequestSchema.safeParse({ apiKey: 'sk-ant-123' }).success).toBe(true);
    expect(SetLlmKeyRequestSchema.safeParse({ apiKey: '' }).success).toBe(false);
  });
});

describe('SavedLlmProvidersResponseSchema', () => {
  test('accepts a list of known providers, rejects an unknown one', () => {
    expect(SavedLlmProvidersResponseSchema.safeParse(['anthropic']).success).toBe(true);
    expect(SavedLlmProvidersResponseSchema.safeParse([]).success).toBe(true);
    expect(SavedLlmProvidersResponseSchema.safeParse(['cohere']).success).toBe(false);
  });
});

describe('DashboardResponseSchema', () => {
  const valid = {
    focusAreas: {
      active: [
        {
          category: 'king_safety',
          status: 'active',
          note: 'Delays castling under pressure.',
          evidenceCount: 3,
          lastSeenAt: '2026-07-20T10:00:00.000Z'
        }
      ],
      resolved: []
    },
    mistakeTrends: [{ category: 'king_safety', last5: 1, last20: 3 }],
    sessionHistory: [
      {
        sessionId: 's1',
        gameId: 'g1',
        startedAt: '2026-07-20T10:00:00.000Z',
        whiteName: 'daniel',
        blackName: 'Marta',
        userColor: 'white',
        result: '1-0',
        summary: 'Worked on king safety.',
        homework: 'Solve 10 puzzles.'
      }
    ]
  };

  test('accepts a valid dashboard response', () => {
    expect(DashboardResponseSchema.safeParse(valid).success).toBe(true);
  });

  test('rejects an unknown focus-area status', () => {
    const bad = { ...valid, focusAreas: { active: [{ ...valid.focusAreas.active[0], status: 'archived' }], resolved: [] } };
    expect(DashboardResponseSchema.safeParse(bad).success).toBe(false);
  });

  test('rejects a negative trend count', () => {
    const bad = { ...valid, mistakeTrends: [{ category: 'king_safety', last5: -1, last20: 3 }] };
    expect(DashboardResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CreditPackSchema', () => {
  test('accepts the 3 packs, rejects others', () => {
    expect(CreditPackSchema.safeParse('small').success).toBe(true);
    expect(CreditPackSchema.safeParse('medium').success).toBe(true);
    expect(CreditPackSchema.safeParse('large').success).toBe(true);
    expect(CreditPackSchema.safeParse('jumbo').success).toBe(false);
  });
});

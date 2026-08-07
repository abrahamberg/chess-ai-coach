import { z } from 'zod';
import { FindingSchema, FocusAreaUpdateSchema, ThreadSchema } from '@chess-coach/shared';

/** architecture §7.1 — parameter schemas for the coach agent's 13 tools. Pure
 * (no execute functions here); apps/api/src/services/coach-tools.ts binds
 * these to real services to build the AI SDK ToolSet. */

/**
 * Standard chess move-pair terminology ("White's move 2", "Black's move
 * 2") instead of a bare ply — a bare ply number is not how PGN moves are
 * named, and asking the model to convert ply <-> move-pair itself in prose
 * ("White's move N is ply 2N-1") reliably produced miscounted navigation.
 * moveNumber 0 with color null addresses the game's starting position.
 * Shared by every tool that addresses a move in this game (show_position,
 * check_position, record_move_note, recall_move) — never a bare ply,
 * anywhere in the tool surface.
 */
const moveAddressShape = {
  moveNumber: z.number().int().nonnegative(),
  color: z.enum(['white', 'black']).nullable()
};

function refineMoveAddress<T extends { moveNumber: number; color: 'white' | 'black' | null }>(value: T): boolean {
  return value.moveNumber === 0 ? value.color === null : value.color !== null;
}

const MOVE_ADDRESS_REFINEMENT_MESSAGE = 'color must be null only when moveNumber is 0 (the game start)';

export const showPositionParameters = z
  .object(moveAddressShape)
  .refine(refineMoveAddress, { message: MOVE_ADDRESS_REFINEMENT_MESSAGE });

/** check_position takes the same {moveNumber, color} address as
 * show_position — it just answers with the FEN instead of moving the
 * student's board. */
export const checkPositionParameters = showPositionParameters;

export const annotateBoardParameters = z.object({
  arrows: z.array(z.object({ from: z.string(), to: z.string(), color: z.string() })),
  highlights: z.array(z.object({ square: z.string(), color: z.string() }))
});

export const getEngineAnalysisParameters = z.object({
  fen: z.string()
});

export const getUserProfileParameters = z.object({});

export const recordFindingParameters = FindingSchema;

export const proposeFocusAreaUpdateParameters = FocusAreaUpdateSchema;

export const updateThreadsParameters = z.object({
  threads: z.array(ThreadSchema)
});

export const endSessionParameters = z.object({
  summary: z.string(),
  homework: z.string().nullable()
});

/** design doc §3: coach-authored per-move note, discretionary (same pattern
 * as record_finding — not mandatory every move). Addressed the same way as
 * show_position/check_position ({ moveNumber, color }) — never a bare ply
 * (final review #1): every other context surface speaks move-pair
 * terminology, and a bare ply here was the one place the model was
 * silently likely to miscount. */
export const recordMoveNoteParameters = z
  .object({ ...moveAddressShape, note: z.string().min(1).max(300) })
  .refine(refineMoveAddress, { message: MOVE_ADDRESS_REFINEMENT_MESSAGE });

/** design doc §4: on-demand deeper lookup for a specific past move, same
 * { moveNumber, color } address as show_position/check_position (final
 * review #1). */
export const recallMoveParameters = showPositionParameters;

/** Armed right before a single-move Socratic question ("what would you play
 * here?") so the client sends the student's next board move immediately
 * instead of folding it into a diverged line. Takes no
 * arguments — it's a pure signal, not an address. */
export const expectMoveParameters = z.object({});

/** Sets up or continues a hypothetical continuation off the CURRENT
 * position — e.g. "if Black had played a4 instead". No { moveNumber, color }
 * address like the other move-referencing tools: the base position is
 * implicit (continues an already-active hypothetical on the client, or
 * falls back to wherever the board currently is) rather than a real-game
 * move, which a continuing hypothetical may no longer have. */
export const hypotheticalLineParameters = z.object({
  moves: z.array(z.string().min(1)).min(1).max(12)
});

export interface CoachToolSpec {
  name: string;
  description: string;
}

/**
 * Single source of truth for what the model is told about each tool — one
 * canonical description per tool, reused verbatim as both the `tool({
 * description })` sent with the API's tool-calling schema
 * (apps/api/src/services/coach-tools.ts) AND the "Your tools and when to use
 * them" bullet rendered into the cached static system prompt
 * (coach-system.ts's yourToolsAndWhenToUseThem()). Previously these were two
 * hand-written copies that had already drifted apart; this is the fix. Order
 * here is the order they're presented to the model in.
 */
export const COACH_TOOL_SPECS: readonly CoachToolSpec[] = [
  {
    name: 'show_position',
    description:
      'Move the student\'s board to a given position, addressed by move number and color. Use standard chess move-pair numbering everywhere, in your prose AND in this tool: "move 18" means White\'s 18th move, or say "move 18 for Black" — never a bare ply. show_position takes exactly that: { moveNumber, color } — e.g. White\'s move 18 is { moveNumber: 18, color: "white" }, Black\'s move 18 is { moveNumber: 18, color: "black" }. There is no arithmetic to do; say the same move you\'d say out loud. For the game\'s starting position, use { moveNumber: 0, color: null }. When in doubt, name the move by its SAN instead of a number. Always call this before discussing a new position, and wait for its result before you speak about the move: this call is also what loads that move\'s own engine analysis into "## Current position" — the move played and its continuation, the engine\'s best move and line, the other options it considered. Until you make it, the analysis you can see is still the PREVIOUS move\'s, and nothing warns you about the mismatch. Its result includes the position\'s real "fen" — that is the ONLY position you actually know; treat it as ground truth and never assume you remember the board from the PGN or from earlier in the conversation.'
  },
  {
    name: 'check_position',
    description:
      'Silently look up the FEN for any move in THIS game, addressed the same way as show_position ({ moveNumber, color }; the game start is { moveNumber: 0, color: null }). Does not move the student\'s board. Use this to get a verified fen before calling get_engine_analysis, or to check a claim about the position before you say it out loud. NEVER invent or reconstruct a FEN from memory — always get it from a show_position result or check_position first.'
  },
  {
    name: 'annotate_board',
    description:
      'Draw arrows/highlights whenever you explain something with a shape on the board — a piece route, a weak square, a pin, a plan — not only when words alone would be ambiguous; this is your default way to show an idea. Keep one idea per call; call it again for the next idea. Cleared automatically on the next show_position.'
  },
  {
    name: 'expect_move',
    description:
      "Call this right before asking a single 'what would you play here?' question, when you expect exactly one move as the answer — the student's next board move is sent to you immediately instead of them building a longer line first. Clears itself after that one move — call it again next time you want the same instant behavior."
  },
  {
    name: 'hypothetical_line',
    description:
      'Set up or continue a diverged line off the CURRENT position (call show_position first if you haven\'t already) — e.g. "if Black had played a4 instead". Pass the SAN move(s) for the hypothetical; the client validates and applies them against real chess rules and reports back the resulting position, including its "resultFen" — never invent a resulting FEN yourself. That fen is what you pass to get_engine_analysis when the line has run far enough that you need the engine on it: a hypothetical position is not part of the game, so unlike a real move it never gets analyzed for you. Pass further moves to keep extending a hypothetical already in progress. This never touches the real game or its move list.'
  },
  {
    name: 'get_engine_analysis',
    description:
      "Runs the engine on a position and returns the full structured analysis: best lines with eval and principal variation, hanging/under-defended pieces, forks, capture opportunities, pawn structure, mobility, and more. The CURRENT position already has this under '## Current position' above — best line, the line actually played, what changed vs. the best move, the full analysis JSON, and other engine options — don't spend a call re-fetching it. Use this tool for OTHER positions: a position inside a hypothetical line (pass the resultFen hypothetical_line gave you — a diverged line is the one case nothing analyzes for you), a candidate line, or an earlier or later move you are only comparing against and not moving to (get its fen from check_position first). If instead you are turning to that move to DISCUSS it, call show_position and let it come back — that brings you the full curated analysis for it and costs you nothing from this budget. Pass a fen you got from show_position or check_position — never one you reconstructed yourself. You get at most 2 checks per reply, so use precise moments and rely on your preparation notes for everything they already cover."
  },
  {
    name: 'get_user_profile',
    description:
      'Read the student\'s focus areas, recent findings, and session history — call it whenever a mistake or idea feels like ground you may have covered before, even if the student hasn\'t asked; the summary above only shows recent items, so check here before repeating an explanation or homework you might have already given.'
  },
  {
    name: 'record_finding',
    description:
      'Record a durable observation about the student\'s thinking or habits — whenever the session reveals a mistake pattern (isPositive: false) or clear improvement (isPositive: true). Write the description as a coach\'s note: specific, one sentence, about their thinking. Record 3–8 findings per session, as they happen, not all at the end.'
  },
  {
    name: 'propose_focus_area_update',
    description:
      'Create, progress, regress, or resolve a focus area based on evidence this session — when this session gives real evidence that a focus area improved/regressed, or a new recurring pattern (2+ occurrences across sessions) deserves focus.'
  },
  {
    name: 'update_threads',
    description:
      'Backstage conversation-thread ledger (see Conversation threading below) — full replace, always pass the complete current list. Call it whenever one of these happens, right when it happens, not in a batch later: (1) you set a topic aside mid-conversation to finish the current one ("good question — hold that, let me finish this line" -> park it); (2) you return to a parked topic ("now, you asked earlier about..." -> mark it active, still in the ledger until you are actually done with it); (3) a parked or active topic gets resolved in conversation -> mark it resolved or drop it; (4) you form a working hypothesis about the student\'s thinking you want to test over the next few moments ("seems to stop calculating after the first capture") -> record it as the hypothesis on the relevant thread; (5) in play mode, you decide on a multi-move plan you\'re testing (e.g. "playing toward a fork on move 14 to see if they notice") -> park it as a thread so you remember to follow up. Ordinary back-and-forth on the CURRENT topic never touches the ledger — this is the single most under-used tool; use it any time one of the five triggers above actually happens, not only when it feels significant. Silent; the student never sees it.'
  },
  {
    name: 'record_move_note',
    description:
      'Save a one-sentence note on a move you\'re about to leave, for your own later reference (e.g. "missed Rxd5, discussed the pin, assigned as homework") — this is how you\'ll remember it later without re-reading the whole discussion. Addressed the same way as show_position/check_position ({ moveNumber, color }; e.g. White\'s move 12 is { moveNumber: 12, color: "white" }) — never a bare ply. Worth calling most of the time you leave a moment — not mechanically every single time.'
  },
  {
    name: 'recall_move',
    description:
      'Look up more detail on a specific earlier move in THIS session than the one-line summary already gives you (in "Other moves discussed" below) — call this when that summary isn\'t enough to answer the student. Addressed the same way as show_position/check_position ({ moveNumber, color }) — never a bare ply.'
  },
  {
    name: 'end_session',
    description:
      'Mark the session complete and trigger the post-session progress summary — call when the walkthrough is done and you have wrapped up. Include a 2–3 sentence summary in the student\'s words and one concrete homework task tied to their focus areas. Before calling it, check your thread ledger: every open or parked thread must be either resolved or deliberately let go (it is fine to close one briefly: "we didn\'t finish the h3 line — look at it at home, it\'s in your homework").'
  }
];

export function coachToolDescription(name: string): string {
  const spec = COACH_TOOL_SPECS.find((s) => s.name === name);
  if (!spec) throw new Error(`no description registered for tool "${name}"`);
  return spec.description;
}

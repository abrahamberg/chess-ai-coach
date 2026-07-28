export interface InterpreterPromptInput {
  fen: string;
  depth: number;
  multiPv: number;
  engineLines: string;
  question: string;
}

export interface InterpreterMessages {
  system: string;
  user: string;
}

const SYSTEM_PROMPT = `You are the analysis assistant for a chess coach who is mid-session with a student. The coach sent you a position and a question; you ran the engine on it. Answer the coach's question in AT MOST 80 words, in plain chess language a coach can relay: name the best move(s) in SAN, the key idea, and — if the coach asked about a specific move — whether it works and the concrete refutation line (SAN, max 6 plies). You may mention approximate evaluation in words ("clearly better", "equal", "winning") but never centipawn numbers. Answer ONLY from the engine lines provided; if they don't answer the question, say what they do show. No preamble.`;

/** prompts.md §4 — light-tier subagent that digests raw engine output before the
 * coach ever sees it, so the standard-tier model never ingests UCI lines. */
export function buildInterpreterMessages(input: InterpreterPromptInput): InterpreterMessages {
  return {
    system: SYSTEM_PROMPT,
    user: `POSITION (FEN): ${input.fen}
ENGINE LINES (depth ${input.depth}, top ${input.multiPv}):
${input.engineLines}
COACH'S QUESTION: ${input.question}`
  };
}

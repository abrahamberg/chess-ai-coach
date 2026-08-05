/**
 * Readers for tool parts inside a stored assistant/tool message.
 *
 * The AI SDK renamed both of these: a tool call's arguments moved from `args`
 * to `input`, and a tool result's payload from a bare `result` to a tagged
 * `output` union. `session_messages` is append-only, so both shapes are on the
 * wire forever and every read has to accept either. Mirrors
 * `apps/api/src/lib/tool-parts.ts` on the server side.
 */

type PartRecord = Record<string, unknown>;

/** A tool call's arguments, under whichever field name they were stored. */
export function toolCallInput(part: PartRecord): unknown {
  return part.input ?? part.args;
}

/** A tool result's payload, unwrapped from the tagged `output` union when
 * present and read straight off `result` when it is not. */
export function toolResultValue(part: PartRecord): unknown {
  const output = part.output;
  if (typeof output === 'object' && output !== null && 'value' in output) {
    return (output as { value: unknown }).value;
  }
  return part.result;
}

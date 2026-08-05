/**
 * Readers for the tool parts stored inside `session_messages.content`.
 *
 * That table is append-only and prompt caching depends on it staying that way,
 * so rows written before the AI SDK upgrade keep the SDK's older field names
 * forever: a tool call's arguments under `args` (now `input`), and a tool
 * result's payload as a bare `result` (now a tagged `output` union). Every
 * read of a stored tool part goes through here so it works on both shapes;
 * `upgradeStoredParts` converts to the current shape on the way back to the
 * provider, which rejects the old one outright.
 */

type PartRecord = Record<string, unknown>;

function asRecord(part: unknown): PartRecord | null {
  return typeof part === 'object' && part !== null ? (part as PartRecord) : null;
}

export function isToolCallPart(part: unknown, toolName?: string): boolean {
  const record = asRecord(part);
  if (record?.type !== 'tool-call') return false;
  return toolName === undefined || record.toolName === toolName;
}

export function isToolResultPart(part: unknown): boolean {
  return asRecord(part)?.type === 'tool-result';
}

export function toolCallId(part: unknown): string | null {
  const id = asRecord(part)?.toolCallId;
  return typeof id === 'string' ? id : null;
}

/** A tool call's arguments, whichever field name they were stored under. */
export function toolCallInput(part: unknown): unknown {
  const record = asRecord(part);
  if (!record) return undefined;
  return record.input ?? record.args;
}

/** A tool result's payload, unwrapped from the tagged `output` union when
 * present and read straight off `result` when it is not. */
export function toolResultValue(part: unknown): unknown {
  const record = asRecord(part);
  if (!record) return undefined;
  const output = asRecord(record.output);
  if (output && 'value' in output) return output.value;
  return record.result;
}

/** Rewrites stored parts into the shape the provider accepts today. Parts
 * already in that shape pass through untouched. */
export function upgradeStoredParts(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map(upgradeStoredPart);
}

function upgradeStoredPart(part: unknown): unknown {
  const record = asRecord(part);
  if (!record) return part;

  if (record.type === 'tool-call' && record.input === undefined && 'args' in record) {
    const { args, ...rest } = record;
    return { ...rest, input: args };
  }

  if (record.type === 'tool-result' && record.output === undefined && 'result' in record) {
    const { result, ...rest } = record;
    return { ...rest, output: { type: 'json', value: result ?? null } };
  }

  return part;
}

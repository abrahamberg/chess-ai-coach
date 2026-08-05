import { asSchema, tool, type Tool, type ToolSet } from 'ai';

/** The app's tool-definition surface. Re-exported (rather than imported from
 * `ai` at each call site) so services/coach-tools.ts stays free of provider
 * SDK imports — AGENTS.md rule 6. */
export { tool, type Tool, type ToolSet };

/** JSON Schema for a tool's input, for the coach debug snapshot. Tools are
 * declared with zod schemas from `@chess-coach/prompts`; `asSchema` accepts
 * either those or an already-converted Schema and exposes the JSON Schema the
 * provider actually sees. Never serializes the `execute` closures. */
export function toolJsonSchema(definition: Tool): unknown {
  if (definition.inputSchema === undefined) return undefined;
  return asSchema(definition.inputSchema).jsonSchema;
}

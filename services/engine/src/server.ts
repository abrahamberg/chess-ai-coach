import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { AnalyzeGameRequestSchema, AnalyzePositionRequestSchema } from '@chess-coach/shared';
import { analyzeGame, analyzePosition, InvalidFenError } from './analyze.js';
import { EnginePool } from './engine-pool.js';
import { DEFAULT_DEPTH, DEFAULT_TIMEOUT_MS, UciEngine } from './uci.js';

export interface BuildServerOptions {
  poolSize?: number;
  defaultDepth?: number;
  moveTimeoutMs?: number;
  engineFactory?: () => UciEngine;
}

/** Builds the engine HTTP service (architecture §4): analyze-game, analyze-position, health. */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const pool = new EnginePool(options.poolSize ?? 2, options.engineFactory);
  const defaultDepth = options.defaultDepth ?? DEFAULT_DEPTH;
  const moveTimeoutMs = options.moveTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  const app = Fastify();

  app.get('/health', async () => ({ status: 'ok', poolSize: pool.size, busy: pool.busy }));

  app.post('/analyze-game', async (request, reply) => {
    const parsed = AnalyzeGameRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationProblem(reply, parsed.error.issues);

    try {
      const evals = await analyzeGame(pool, parsed.data.fens, {
        depth: parsed.data.depth ?? defaultDepth,
        multiPv: parsed.data.multiPv,
        timeoutMs: moveTimeoutMs
      });
      return { evals };
    } catch (error) {
      return sendEngineErrorProblem(reply, error);
    }
  });

  app.post('/analyze-position', async (request, reply) => {
    const parsed = AnalyzePositionRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationProblem(reply, parsed.error.issues);

    try {
      const evaluation = await analyzePosition(pool, parsed.data.fen, 0, {
        depth: parsed.data.depth ?? defaultDepth,
        multiPv: parsed.data.multiPv,
        timeoutMs: moveTimeoutMs
      });
      return { eval: evaluation };
    } catch (error) {
      return sendEngineErrorProblem(reply, error);
    }
  });

  return app;
}

function sendValidationProblem(reply: FastifyReply, issues: { message: string }[]): FastifyReply {
  return reply.code(400).type('application/problem+json').send({
    type: 'about:blank',
    title: 'Invalid request body',
    status: 400,
    detail: issues.map((issue) => issue.message).join('; ')
  });
}

function sendEngineErrorProblem(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof InvalidFenError) {
    return reply.code(400).type('application/problem+json').send({
      type: 'about:blank',
      title: 'Invalid FEN',
      status: 400,
      detail: error.message
    });
  }
  throw error;
}

function readEnvConfig(): BuildServerOptions {
  return {
    poolSize: Number(process.env.ENGINE_POOL_SIZE ?? 2),
    defaultDepth: Number(process.env.ENGINE_DEFAULT_DEPTH ?? DEFAULT_DEPTH),
    moveTimeoutMs: Number(process.env.ENGINE_MOVE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
  };
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const app = buildServer(readEnvConfig());
  const port = Number(process.env.PORT ?? 8081);
  app.listen({ port, host: '0.0.0.0' }).catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
}

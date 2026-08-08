import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { noopJobQueue } from './jobs/queue.js';
import {
  buildCoachAgentDependencies,
  buildGatewayConfigFromEnv,
  buildModelTuningFromEnv,
  buildResolveEngineBackendOptions,
  buildStripeClientFromEnv,
  requireEnv
} from './bootstrap.js';

const REQUIRED_ENV = {
  LLM_STANDARD_MODEL_ANTHROPIC: 'claude-standard',
  LLM_STANDARD_MODEL_OPENAI: 'gpt-standard',
  LLM_LIGHT_MODEL_ANTHROPIC: 'claude-light',
  LLM_LIGHT_MODEL_OPENAI: 'gpt-light'
};

describe('requireEnv', () => {
  const ORIGINAL = process.env.SOME_TEST_VAR;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.SOME_TEST_VAR;
    else process.env.SOME_TEST_VAR = ORIGINAL;
  });

  test('returns the value when set', () => {
    process.env.SOME_TEST_VAR = 'hello';
    expect(requireEnv('SOME_TEST_VAR')).toBe('hello');
  });

  test('throws a descriptive error when missing', () => {
    delete process.env.SOME_TEST_VAR;
    expect(() => requireEnv('SOME_TEST_VAR')).toThrow(/SOME_TEST_VAR/);
  });
});

describe('buildGatewayConfigFromEnv', () => {
  const ORIGINAL_ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    for (const key of Object.keys(REQUIRED_ENV)) delete process.env[key];
    if (ORIGINAL_ANTHROPIC_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_KEY;
    if (ORIGINAL_OPENAI_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
  });

  test('reads model ids and platform keys from the environment', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const keyVault = { encrypt: vi.fn(), decrypt: vi.fn() };

    const config = buildGatewayConfigFromEnv(keyVault);

    expect(config.keyVault).toBe(keyVault);
    expect(config.platformKeys).toEqual({ anthropic: 'sk-ant-platform', openai: undefined });
    expect(config.modelIds).toEqual({
      standard: { anthropic: 'claude-standard', openai: 'gpt-standard' },
      light: { anthropic: 'claude-light', openai: 'gpt-light' }
    });
  });

  test('throws when a required model id env var is missing', () => {
    delete process.env.LLM_LIGHT_MODEL_ANTHROPIC;
    const keyVault = { encrypt: vi.fn(), decrypt: vi.fn() };
    expect(() => buildGatewayConfigFromEnv(keyVault)).toThrow(/LLM_LIGHT_MODEL_ANTHROPIC/);
  });

  test('fake is false by default, true when LLM_FAKE=1', () => {
    const keyVault = { encrypt: vi.fn(), decrypt: vi.fn() };
    expect(buildGatewayConfigFromEnv(keyVault).fake).toBe(false);

    process.env.LLM_FAKE = '1';
    expect(buildGatewayConfigFromEnv(keyVault).fake).toBe(true);
    delete process.env.LLM_FAKE;
  });
});

describe('buildStripeClientFromEnv', () => {
  const STRIPE_ENV_KEYS = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_SMALL',
    'STRIPE_PRICE_MEDIUM',
    'STRIPE_PRICE_LARGE',
    'STRIPE_CHECKOUT_SUCCESS_URL',
    'STRIPE_CHECKOUT_CANCEL_URL'
  ] as const;
  const ORIGINAL = Object.fromEntries(STRIPE_ENV_KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of STRIPE_ENV_KEYS) {
      const original = ORIGINAL[key];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  test('returns undefined when STRIPE_SECRET_KEY is unset, so docker-compose dev works with no Stripe configured', () => {
    for (const key of STRIPE_ENV_KEYS) delete process.env[key];
    expect(buildStripeClientFromEnv()).toBeUndefined();
  });

  test('throws a descriptive error when STRIPE_SECRET_KEY is set but a companion var is missing', () => {
    for (const key of STRIPE_ENV_KEYS) delete process.env[key];
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    expect(() => buildStripeClientFromEnv()).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  test('builds a StripeClient once every STRIPE_* var is set', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.STRIPE_PRICE_SMALL = 'price_small';
    process.env.STRIPE_PRICE_MEDIUM = 'price_medium';
    process.env.STRIPE_PRICE_LARGE = 'price_large';
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'https://example.com/success';
    process.env.STRIPE_CHECKOUT_CANCEL_URL = 'https://example.com/cancel';

    const client = buildStripeClientFromEnv();

    expect(client).toBeDefined();
    expect(client?.createCheckoutSession).toBeInstanceOf(Function);
    expect(client?.parseWebhookEvent).toBeInstanceOf(Function);
  });
});

describe('buildCoachAgentDependencies', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function gatewayConfig() {
    return {
      keyVault: { encrypt: vi.fn(), decrypt: vi.fn() },
      platformKeys: { anthropic: 'sk-ant-platform' },
      modelIds: {
        standard: { anthropic: 'claude-standard', openai: 'gpt-standard' },
        light: { anthropic: 'claude-light', openai: 'gpt-light' }
      }
    };
  }

  test('analyzePosition posts to {engineUrl}/analyze-position and returns the analysis', async () => {
    const analysis = {
      fen: 'f',
      depth: 16,
      multiPv: 0,
      bestMove: null,
      eval: { cp: null, mateIn: null },
      lines: [],
      features: { turn: 'white', boardState: 'none' }
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ analysis }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const deps = buildCoachAgentDependencies({} as never, noopJobQueue, gatewayConfig(), 'http://engine:4001');
    const result = await deps.analyzePosition('some-fen');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://engine:4001/analyze-position',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ fen: 'some-fen', multiPv: 3 }) })
    );
    expect(result).toEqual(analysis);
  });

  test('analyzePosition caches by exact fen — a repeat call for the same fen does not re-hit the engine', async () => {
    const analysis = {
      fen: 'f',
      depth: 16,
      multiPv: 0,
      bestMove: null,
      eval: { cp: null, mateIn: null },
      lines: [],
      features: { turn: 'white', boardState: 'none' }
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ analysis }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const deps = buildCoachAgentDependencies({} as never, noopJobQueue, gatewayConfig(), 'http://engine:4001');
    const first = await deps.analyzePosition('some-fen');
    const second = await deps.analyzePosition('some-fen');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(analysis);
    expect(second).toEqual(analysis);
  });

  test('analyzePosition throws on a non-2xx engine response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const deps = buildCoachAgentDependencies({} as never, noopJobQueue, gatewayConfig(), 'http://engine:4001');
    await expect(deps.analyzePosition('some-fen')).rejects.toThrow();
  });

  test('under a fake gateway config, callLightModel works without any platform key', async () => {
    const deps = buildCoachAgentDependencies(
      {} as never,
      noopJobQueue,
      { ...gatewayConfig(), platformKeys: {}, fake: true },
      'http://engine:4001'
    );

    const text = await deps.callLightModel({ system: 'sys', user: 'hi' });
    expect(text.length).toBeGreaterThan(0);
  });
});

describe('buildModelTuningFromEnv', () => {
  const TUNING_VARS = [
    'LLM_REASONING_STANDARD',
    'LLM_REASONING_LIGHT',
    'LLM_OPENAI_SERVICE_TIER',
    'LLM_STREAM_FIRST_CHUNK_TIMEOUT_MS',
    'LLM_STREAM_CHUNK_TIMEOUT_MS'
  ];

  beforeEach(() => {
    for (const key of TUNING_VARS) delete process.env[key];
  });
  afterEach(() => {
    for (const key of TUNING_VARS) delete process.env[key];
  });

  test('with nothing set, reasons on the coach tier only and leaves flex off', () => {
    const tuning = buildModelTuningFromEnv();

    expect(tuning.reasoning).toEqual({ standard: 'medium', light: 'none' });
    expect(tuning.openaiServiceTier).toBe('auto');
    expect(tuning.streamTimeouts.firstChunkMs).toBeGreaterThan(0);
  });

  test('reads reasoning effort per tier', () => {
    process.env.LLM_REASONING_STANDARD = 'high';
    process.env.LLM_REASONING_LIGHT = 'low';

    expect(buildModelTuningFromEnv().reasoning).toEqual({ standard: 'high', light: 'low' });
  });

  test('reads the OpenAI service tier, which is how flex gets switched on', () => {
    process.env.LLM_OPENAI_SERVICE_TIER = 'flex';

    expect(buildModelTuningFromEnv().openaiServiceTier).toBe('flex');
  });

  test('reads stream timeouts', () => {
    process.env.LLM_STREAM_FIRST_CHUNK_TIMEOUT_MS = '5000';
    process.env.LLM_STREAM_CHUNK_TIMEOUT_MS = '2500';

    expect(buildModelTuningFromEnv().streamTimeouts).toEqual({ firstChunkMs: 5000, chunkMs: 2500 });
  });

  // A typo here would otherwise surface as an opaque provider 400 on the first
  // real turn, long after the deploy that caused it.
  test.each([
    ['LLM_REASONING_STANDARD', 'aggressive'],
    ['LLM_REASONING_LIGHT', 'off'],
    ['LLM_OPENAI_SERVICE_TIER', 'cheap'],
    ['LLM_STREAM_CHUNK_TIMEOUT_MS', 'soon'],
    ['LLM_STREAM_CHUNK_TIMEOUT_MS', '-1']
  ])('rejects an invalid %s at boot rather than at the provider', (name, value) => {
    process.env[name] = value;

    expect(() => buildModelTuningFromEnv()).toThrow(name);
  });
});

describe('buildResolveEngineBackendOptions', () => {
  afterEach(() => delete process.env.ENGINE_TUNNEL_TIMEOUT_MS);

  test('defaults tunnelTimeoutMs to 10000', () => {
    const options = buildResolveEngineBackendOptions({} as never, 'http://engine:4001', { request: vi.fn() });
    expect(options.tunnelTimeoutMs).toBe(10000);
  });

  test('reads ENGINE_TUNNEL_TIMEOUT_MS when set', () => {
    process.env.ENGINE_TUNNEL_TIMEOUT_MS = '5000';
    const options = buildResolveEngineBackendOptions({} as never, 'http://engine:4001', { request: vi.fn() });
    expect(options.tunnelTimeoutMs).toBe(5000);
  });
});

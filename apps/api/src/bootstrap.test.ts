import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { noopJobQueue } from './jobs/queue.js';
import { buildCoachAgentDependencies, buildGatewayConfigFromEnv, requireEnv } from './bootstrap.js';

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

  test('analyzePosition posts to {engineUrl}/analyze-position and returns the eval', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ eval: { ply: 0, fen: 'f', depth: 16, lines: [] } }), {
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
    expect(result).toEqual({ ply: 0, fen: 'f', depth: 16, lines: [] });
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

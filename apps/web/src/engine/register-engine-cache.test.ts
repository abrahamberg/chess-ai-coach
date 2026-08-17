import { afterEach, describe, expect, test, vi } from 'vitest';
import { registerEngineCache } from './register-engine-cache.js';

describe('registerEngineCache', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  test('registers the engine service worker when supported', () => {
    const register = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });

    registerEngineCache();

    expect(register).toHaveBeenCalledWith('/engine-sw.js');
  });

  test('does nothing when the browser has no service worker support', () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    expect(() => registerEngineCache()).not.toThrow();
  });

  test('swallows a registration failure', async () => {
    const register = vi.fn().mockRejectedValue(new Error('nope'));
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });

    expect(() => registerEngineCache()).not.toThrow();
    await Promise.resolve();
  });
});

import { describe, expect, test } from 'vitest';
import { createKeyedLock } from './keyedLock.js';

describe('createKeyedLock', () => {
  test('a second acquire for the same key resolves only after the first releases', async () => {
    const lock = createKeyedLock();
    const order: string[] = [];

    const release1 = await lock.acquire('s1');
    order.push('acquired-1');

    let acquired2 = false;
    const p2 = lock.acquire('s1').then((release2) => {
      acquired2 = true;
      order.push('acquired-2');
      release2();
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(acquired2).toBe(false);

    release1();
    await p2;

    expect(acquired2).toBe(true);
    expect(order).toEqual(['acquired-1', 'acquired-2']);
  });

  test('acquires for different keys do not block each other', async () => {
    const lock = createKeyedLock();
    await lock.acquire('a'); // never released

    const acquiredB = await Promise.race([
      lock.acquire('b').then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 50))
    ]);

    expect(acquiredB).toBe(true);
  });
});

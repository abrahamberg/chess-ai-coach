import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { createKeyVault } from './key-vault.js';

const MASTER_KEY = randomBytes(32).toString('base64');

describe('createKeyVault', () => {
  test('round-trips a plaintext through encrypt/decrypt', () => {
    const vault = createKeyVault(MASTER_KEY);

    const encrypted = vault.encrypt('sk-ant-super-secret');

    expect(vault.decrypt(encrypted)).toBe('sk-ant-super-secret');
  });

  test('produces a distinct IV (and ciphertext) on every call, even for the same plaintext', () => {
    const vault = createKeyVault(MASTER_KEY);

    const first = vault.encrypt('sk-ant-super-secret');
    const second = vault.encrypt('sk-ant-super-secret');

    expect(first.iv.equals(second.iv)).toBe(false);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
  });

  test('rejects a tampered ciphertext instead of silently returning garbage', () => {
    const vault = createKeyVault(MASTER_KEY);
    const encrypted = vault.encrypt('sk-ant-super-secret');
    const tampered = { iv: encrypted.iv, ciphertext: Buffer.from(encrypted.ciphertext) };
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 0xff;

    expect(() => vault.decrypt(tampered)).toThrow();
  });

  test('rejects a master key that is not 32 bytes', () => {
    expect(() => createKeyVault(Buffer.from('too-short').toString('base64'))).toThrow();
  });
});

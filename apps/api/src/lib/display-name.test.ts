import { describe, expect, test } from 'vitest';
import { emailLocalPart, looksLikeOpaqueId, resolveDisplayName } from './display-name.js';

describe('resolveDisplayName', () => {
  test('prefers an actual preferred-username claim', () => {
    expect(
      resolveDisplayName({ preferredUsername: 'dabrahamberg', legacyUser: '108234821730984723', email: 'd@x.com' })
    ).toBe('dabrahamberg');
  });

  test('falls back to the legacy user field when it looks like a real name, not an opaque id', () => {
    expect(resolveDisplayName({ preferredUsername: null, legacyUser: 'Daniel', email: 'd@x.com' })).toBe('Daniel');
  });

  test('skips a Google-sub-shaped legacy user field and uses the email local part instead', () => {
    expect(
      resolveDisplayName({ preferredUsername: null, legacyUser: '108234821730984723', email: 'daniel@gmail.com' })
    ).toBe('daniel');
  });

  test('falls back to the email local part when nothing else is available', () => {
    expect(resolveDisplayName({ preferredUsername: null, legacyUser: null, email: 'daniel@gmail.com' })).toBe(
      'daniel'
    );
  });
});

describe('looksLikeOpaqueId', () => {
  test('flags a long digit-only string (a Google account id)', () => {
    expect(looksLikeOpaqueId('108234821730984723')).toBe(true);
  });

  test('does not flag a real name or handle', () => {
    expect(looksLikeOpaqueId('Daniel')).toBe(false);
    expect(looksLikeOpaqueId('dabrahamberg99')).toBe(false);
  });

  test('does not flag a short or plausibly-user-chosen number', () => {
    expect(looksLikeOpaqueId('12345')).toBe(false);
    expect(looksLikeOpaqueId('123456789')).toBe(false);
  });
});

describe('emailLocalPart', () => {
  test('returns the part before @', () => {
    expect(emailLocalPart('daniel@gmail.com')).toBe('daniel');
  });
});

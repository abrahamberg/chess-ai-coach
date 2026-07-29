import { describe, expect, test } from 'vitest';
import { encodeArrowToken, splitArrowTokens } from './arrowToken.js';

describe('encodeArrowToken', () => {
  test('encodes a from/to square pair as a bracketed token', () => {
    expect(encodeArrowToken({ from: 'e2', to: 'e4' })).toBe('[e2-e4]');
  });
});

describe('splitArrowTokens', () => {
  test('a plain message with no token is a single text segment', () => {
    expect(splitArrowTokens('hello coach')).toEqual([{ type: 'text', value: 'hello coach' }]);
  });

  test('an inline token becomes an arrow segment, surrounded by its text', () => {
    expect(splitArrowTokens('I think [e2-e4] is a good option')).toEqual([
      { type: 'text', value: 'I think ' },
      { type: 'arrow', from: 'e2', to: 'e4' },
      { type: 'text', value: ' is a good option' }
    ]);
  });

  test('a token at the very start or end has no adjacent empty text segment', () => {
    expect(splitArrowTokens('[e2-e4] looks strong')).toEqual([
      { type: 'arrow', from: 'e2', to: 'e4' },
      { type: 'text', value: ' looks strong' }
    ]);
    expect(splitArrowTokens('what about [e2-e4]')).toEqual([
      { type: 'text', value: 'what about ' },
      { type: 'arrow', from: 'e2', to: 'e4' }
    ]);
  });

  test('multiple tokens in one message', () => {
    expect(splitArrowTokens('[e2-e4] or [d2-d4]?')).toEqual([
      { type: 'arrow', from: 'e2', to: 'e4' },
      { type: 'text', value: ' or ' },
      { type: 'arrow', from: 'd2', to: 'd4' },
      { type: 'text', value: '?' }
    ]);
  });
});

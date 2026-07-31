import { describe, expect, test } from 'vitest';
import { currentEpisode } from './episodes.js';

interface Fixture {
  id: string;
  ply: number | null;
}

function message(id: string, ply: number | null): Fixture {
  return { id, ply };
}

describe('currentEpisode', () => {
  test('a fresh session with everything at ply 0 returns the whole transcript and no previousPly', () => {
    const messages = [message('1', 0), message('2', 0), message('3', 0)];
    const result = currentEpisode(messages, 0);
    expect(result.messages).toEqual(messages);
    expect(result.previousPly).toBeNull();
  });

  test('a contiguous run at the end sharing currentPly is returned; earlier plies are excluded', () => {
    const messages = [message('1', 0), message('2', 0), message('3', 4), message('4', 4)];
    const result = currentEpisode(messages, 4);
    expect(result.messages.map((m) => m.id)).toEqual(['3', '4']);
    expect(result.previousPly).toBe(0);
  });

  test('revisiting an earlier ply starts a fresh episode — the first visit is NOT merged back in', () => {
    const messages = [message('1', 0), message('2', 4), message('3', 4), message('4', 0), message('5', 0)];
    const result = currentEpisode(messages, 0);
    expect(result.messages.map((m) => m.id)).toEqual(['4', '5']);
    expect(result.previousPly).toBe(4);
  });

  test('an empty transcript returns an empty episode and no previousPly', () => {
    const result = currentEpisode([], 0);
    expect(result.messages).toEqual([]);
    expect(result.previousPly).toBeNull();
  });

  test('a null-ply message (legacy/untagged) never matches and acts as an episode boundary', () => {
    const messages = [message('1', null), message('2', 4), message('3', 4)];
    const result = currentEpisode(messages, 4);
    expect(result.messages.map((m) => m.id)).toEqual(['2', '3']);
    expect(result.previousPly).toBeNull();
  });
});

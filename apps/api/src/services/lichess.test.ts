import { describe, expect, test, vi } from 'vitest';
import { createLichessClient } from './lichess.js';

const NDJSON_FIXTURE = [
  JSON.stringify({
    id: 'abcd1234',
    createdAt: 1721476800000,
    players: { white: { user: { name: 'daniel' } }, black: { user: { name: 'Marta' } } },
    pgn: '[White "daniel"]\n[Black "Marta"]\n[Result "1-0"]\n[TimeControl "600+0"]\n\n1. e4 e5 2. Nf3 1-0'
  }),
  JSON.stringify({
    id: 'efgh5678',
    createdAt: 1721390400000,
    players: { white: { user: { name: 'Bob' } }, black: { user: { name: 'daniel' } } },
    pgn: '[White "Bob"]\n[Black "daniel"]\n[Result "0-1"]\n\n1. d4 d5 0-1'
  })
].join('\n');

describe('createLichessClient', () => {
  test('fetches ndjson games for the last-20 endpoint and parses each into a recent-game row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(NDJSON_FIXTURE, { status: 200 }));
    const client = createLichessClient(fetchMock as unknown as typeof fetch);

    const games = await client.fetchRecentGames('daniel');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://lichess.org/api/games/user/daniel?max=20&pgnInJson=true',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/x-ndjson' }) })
    );
    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({
      id: 'abcd1234',
      whiteName: 'daniel',
      blackName: 'Marta',
      result: '1-0',
      timeControl: '600+0'
    });
    expect(games[1]).toMatchObject({ id: 'efgh5678', whiteName: 'Bob', blackName: 'daniel', result: '0-1' });
  });

  test('throws when the Lichess API responds with a non-2xx status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    const client = createLichessClient(fetchMock as unknown as typeof fetch);

    await expect(client.fetchRecentGames('nobody')).rejects.toThrow();
  });

  test('handles an empty games list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    const client = createLichessClient(fetchMock as unknown as typeof fetch);

    const games = await client.fetchRecentGames('nogames');

    expect(games).toEqual([]);
  });
});

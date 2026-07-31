import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DebugPanel } from './DebugPanel.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const SNAPSHOT = {
  request: {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    messages: [
      {
        role: 'system',
        content: 'You are a chess coach.',
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
      },
      {
        role: 'system',
        content: 'Session context.',
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
      },
      { role: 'user', content: 'why did I lose the exchange?' },
      { role: 'assistant', content: 'Your rook was undefended.' },
      { role: 'user', content: 'anything else I could have done?' },
      { role: 'assistant', content: 'Yes, castling early would have helped.' },
      { role: 'user', content: 'show me the position' }
    ],
    tools: [{ name: 'show_position', description: "Move the student's board.", parameters: { type: 'object' } }],
    maxSteps: 8
  },
  response: {
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'The student wants the earlier position.' },
          { type: 'text', text: "Here's the position — see how e7 was undefended." }
        ]
      }
    ],
    finishReason: 'stop',
    usage: { freshInputTokens: 412, cacheReadTokens: 2180, cacheWriteTokens: 0, outputTokens: 186 },
    providerMetadata: { anthropic: { cacheCreationInputTokens: 0, cacheReadInputTokens: 2180 } }
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DebugPanel', () => {
  test('fetches the latest-turn snapshot and renders provider/model, usage tiles, and role-colored cards', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SNAPSHOT)));

    render(<DebugPanel sessionId="session-1" onClose={vi.fn()} />);

    expect(await screen.findByText('anthropic')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument();

    expect(screen.getByText('412')).toBeInTheDocument(); // fresh input
    expect(screen.getByText('2,180')).toBeInTheDocument(); // cache read
    expect(screen.getByText('186')).toBeInTheDocument(); // output

    const systemPills = screen.getAllByText('system');
    expect(systemPills).toHaveLength(2);
    expect(screen.getAllByText('cached')).toHaveLength(2);
  });

  test('shows "n/a" (never "0") for a null cache-write value, e.g. OpenAI turns', async () => {
    const openaiSnapshot = {
      ...SNAPSHOT,
      request: { ...SNAPSHOT.request, provider: 'openai', model: 'gpt-5' },
      response: {
        ...SNAPSHOT.response,
        usage: { freshInputTokens: 412, cacheReadTokens: 2180, cacheWriteTokens: null, outputTokens: 186 }
      }
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(openaiSnapshot)));

    render(<DebugPanel sessionId="session-1" onClose={vi.fn()} />);

    expect(await screen.findByText('n/a')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  test('the last few request messages start expanded, earlier ones start collapsed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SNAPSHOT)));

    render(<DebugPanel sessionId="session-1" onClose={vi.fn()} />);
    await screen.findByText('anthropic');

    // The earliest user message ("why did I lose the exchange?") is more than
    // 3 messages back from the end — starts collapsed, so its full text isn't
    // in the document, only the truncated preview span carries it.
    const earlyPreview = screen.getByText('why did I lose the exchange?');
    expect(earlyPreview.closest('[data-role]')).toHaveClass('debug-panel__msg--collapsed');

    // The last request message is within the trailing 3 — starts expanded, so
    // its text now appears twice (the preview span, and the expanded body).
    const lastPreview = screen.getAllByText('show me the position')[0] as HTMLElement;
    expect(lastPreview.closest('[data-role]')).not.toHaveClass('debug-panel__msg--collapsed');
  });

  test('clicking a collapsed message row expands it', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SNAPSHOT)));

    render(<DebugPanel sessionId="session-1" onClose={vi.fn()} />);
    await screen.findByText('anthropic');

    const row = screen.getByText('why did I lose the exchange?').closest('[data-role]') as HTMLElement;
    expect(row).toHaveClass('debug-panel__msg--collapsed');

    await user.click(within(row).getByRole('button'));

    expect(row).not.toHaveClass('debug-panel__msg--collapsed');
  });

  test('response reasoning content renders in a distinct reasoning block', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SNAPSHOT)));

    render(<DebugPanel sessionId="session-1" onClose={vi.fn()} />);

    expect(await screen.findByText('The student wants the earlier position.')).toBeInTheDocument();
    expect(screen.getByText("Here's the position — see how e7 was undefended.")).toBeInTheDocument();
  });

  test('copy button writes the raw snapshot JSON to the clipboard', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SNAPSHOT)));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<DebugPanel sessionId="session-1" onClose={vi.fn()} />);
    await screen.findByText('anthropic');

    await user.click(screen.getByRole('button', { name: /copy json/i }));

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(SNAPSHOT, null, 2));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  test('a 404 (no completed turn yet) renders an inline message instead of failing silently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'not found' }, 404)));

    render(<DebugPanel sessionId="session-1" onClose={vi.fn()} />);

    expect(await screen.findByText(/no completed turn to debug yet/i)).toBeInTheDocument();
  });
});

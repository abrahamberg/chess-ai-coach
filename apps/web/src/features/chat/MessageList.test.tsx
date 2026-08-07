import type { ParsedPosition } from '@chess-coach/chess-analysis';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CoachMessage } from '../../hooks/useCoachChat.js';
import { MessageList } from './MessageList.js';

function msg(id: string, text: string): CoachMessage {
  return { id, role: 'assistant', text };
}

function setScrollGeometry(el: HTMLElement, { scrollTop, scrollHeight, clientHeight }: Record<string, number>) {
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
}

describe('MessageList', () => {
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('design.md §5.3: one small avatar starts each coach run, not every message', () => {
    render(
      <MessageList
        messages={[
          msg('1', 'first coach line'),
          msg('2', 'second coach line'),
          { id: '3', role: 'user', text: 'my reply' },
          { id: '4', role: 'assistant', text: 'new coach run' }
        ]}
      />
    );

    expect(screen.getAllByText('♞')).toHaveLength(2);
  });

  test('design.md §7: coach messages stream into an aria-live polite region', () => {
    render(<MessageList messages={[msg('1', 'hi')]} />);
    expect(screen.getByTestId('message-list')).toHaveAttribute('aria-live', 'polite');
  });

  test('auto-scrolls to the bottom when a new message arrives while at the bottom', () => {
    const { rerender } = render(<MessageList messages={[msg('1', 'hi')]} />);
    const container = screen.getByTestId('message-list');
    setScrollGeometry(container, { scrollTop: 100, scrollHeight: 120, clientHeight: 20 }); // at bottom
    fireEvent.scroll(container);

    rerender(<MessageList messages={[msg('1', 'hi'), msg('2', 'more')]} />);

    expect(container.scrollTo).toHaveBeenCalled();
  });

  test('suppresses auto-scroll when the user has scrolled up', () => {
    const { rerender } = render(<MessageList messages={[msg('1', 'hi')]} />);
    const container = screen.getByTestId('message-list');
    setScrollGeometry(container, { scrollTop: 0, scrollHeight: 500, clientHeight: 20 }); // scrolled way up
    fireEvent.scroll(container);
    vi.mocked(container.scrollTo).mockClear(); // ignore the initial-mount scroll-to-bottom

    rerender(<MessageList messages={[msg('1', 'hi'), msg('2', 'more')]} />);

    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  test('design.md §5.3: renders a [board_move] message as a compact move card, not raw plumbing text', () => {
    render(
      <MessageList
        messages={[
          {
            id: '1',
            role: 'user',
            text: '[board_move] I played Nf3 (position now: rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1)'
          }
        ]}
      />
    );

    expect(screen.getByText(/you played/i)).toBeInTheDocument();
    expect(screen.getByText('Nf3')).toBeInTheDocument();
    expect(screen.queryByText(/\[board_move\]/)).not.toBeInTheDocument();
    expect(screen.queryByText(/position now/i)).not.toBeInTheDocument();
  });

  // architecture §14: the student's play-mode move, sent as
  // "[player_move] I played <san>." after POST /play-move commits it — same
  // compact move card as [board_move], just without a fen (play mode's
  // board is already at the resulting position by the time this arrives).
  test('design.md §5.3: renders a [player_move] message as a compact move card, not raw plumbing text', () => {
    render(<MessageList messages={[{ id: '1', role: 'user', text: '[player_move] I played Nf3.' }]} />);

    expect(screen.getByText(/you played/i)).toBeInTheDocument();
    expect(screen.getByText('Nf3')).toBeInTheDocument();
    expect(screen.queryByText(/\[player_move\]/)).not.toBeInTheDocument();
  });

  test('design.md §5.3: renders a position-divider sentinel with standard move-pair numbering', () => {
    render(<MessageList messages={[{ id: '1', role: 'assistant', text: '[position_divider]|14|Bg4' }]} />);

    // ply 14 is Black's 7th move (ceil(14/2)), not "move 14".
    expect(screen.getByText(/move 7/)).toBeInTheDocument();
    expect(screen.getByText('Bg4')).toBeInTheDocument();
  });

  test('clicking a position-divider calls onSelectPly with its ply', () => {
    const onSelectPly = vi.fn();
    render(
      <MessageList
        messages={[{ id: '1', role: 'assistant', text: '[position_divider]|14|Bg4' }]}
        onSelectPly={onSelectPly}
      />
    );

    screen.getByRole('button').click();

    expect(onSelectPly).toHaveBeenCalledWith(14);
  });

  test('renders a [position_context] sentinel as a "back to move N" note above the student message', () => {
    render(
      <MessageList
        messages={[
          {
            id: '1',
            role: 'user',
            text: '[position_context] Back at move 9 (black), after bxc3: what should I look at here?'
          }
        ]}
      />
    );

    expect(screen.getByText(/move 9 \(black\)/i)).toBeInTheDocument();
    expect(screen.getByText('bxc3')).toBeInTheDocument();
    expect(screen.getByText('what should I look at here?')).toBeInTheDocument();
    expect(screen.queryByText(/\[position_context\]/)).not.toBeInTheDocument();
  });

  test('design.md §5.7: renders an inline [e2-e4] arrow token within a plain message as a badge, not raw brackets', () => {
    render(<MessageList messages={[{ id: '1', role: 'user', text: 'I think [e2-e4] is a good option' }]} />);

    expect(screen.getByText('I think', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('e2')).toBeInTheDocument();
    expect(screen.getByText('e4')).toBeInTheDocument();
    expect(screen.queryByText(/\[e2-e4\]/)).not.toBeInTheDocument();
  });

  test('renders a [diverged_line_start] sentinel announcing a coach-proposed hypothetical', () => {
    render(
      <MessageList
        messages={[
          {
            id: '1',
            role: 'assistant',
            text: '[diverged_line_start]|{"basePly":25,"sanMoves":["a3","f6"],"resultFen":"some-fen"}'
          }
        ]}
      />
    );

    expect(screen.getByText(/move 13 \(black\)/i)).toBeInTheDocument();
    expect(screen.getByText('13...a3 14.f6')).toBeInTheDocument();
  });

  test('renders a [diverged_line] sentinel as an "exploring from move N" note above the student message', () => {
    render(
      <MessageList
        messages={[
          {
            id: '1',
            role: 'user',
            text: '[diverged_line] Exploring from move 13 (black): 13...a3 14.f6 a4 (position now: some-fen): what if instead?'
          }
        ]}
      />
    );

    expect(screen.getByText(/move 13 \(black\)/i)).toBeInTheDocument();
    expect(screen.getByText('13...a3 14.f6 a4')).toBeInTheDocument();
    expect(screen.getByText('what if instead?')).toBeInTheDocument();
    expect(screen.queryByText(/\[diverged_line\]/)).not.toBeInTheDocument();
  });

  test('renders a coach ** bold ** span as real emphasis, not literal asterisks', () => {
    render(<MessageList messages={[msg('1', 'that was **not** the right idea')]} />);

    expect(screen.getByText('not').tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  test('a SAN move mention resolvable against the current fen is hoverable and calls onHoverMove', async () => {
    const onHoverMove = vi.fn();
    const user = userEvent.setup();
    render(<MessageList messages={[msg('1', 'what about b3 here?')]} fen={START_FEN} onHoverMove={onHoverMove} />);

    await user.hover(screen.getByText('b3'));
    expect(onHoverMove).toHaveBeenCalledWith({ from: 'b2', to: 'b3' });

    await user.unhover(screen.getByText('b3'));
    expect(onHoverMove).toHaveBeenCalledWith(null);
  });

  test('a move mention illegal in the current position renders as plain text, not hoverable', () => {
    render(<MessageList messages={[msg('1', 'what about Nf6 here?')]} fen={START_FEN} />);

    expect(screen.getByText(/what about/)).toBeInTheDocument();
    expect(document.querySelector('.move-mention')).not.toBeInTheDocument();
  });

  test('a numbered move mention resolves against the historical position it names, not the live board fen', async () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 — by the time this position is on
    // the board, "Bc4" is no longer a legal move (the bishop is already
    // there), so resolving against the live fen would fail. The FEN before
    // ply 5 (White's 3rd move) is what "3.Bc4" actually names.
    const liveFen = 'r1bqkb1r/pppp1ppp/2n2n2/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R b KQkq - 5 4';
    const positions: ParsedPosition[] = [
      {
        ply: 4,
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
        moveSan: 'Nc6',
        moveUci: 'b8c6',
        mover: 'black'
      }
    ];
    const onHoverMove = vi.fn();
    const user = userEvent.setup();
    render(
      <MessageList
        messages={[msg('1', 'After 3.Bc4, you developed naturally')]}
        fen={liveFen}
        positions={positions}
        onHoverMove={onHoverMove}
      />
    );

    await user.hover(screen.getByText('3. Bc4'));
    expect(onHoverMove).toHaveBeenCalledWith({ from: 'f1', to: 'c4' });
  });

  test('a bold move mention stays bold while also being hoverable', async () => {
    const onHoverMove = vi.fn();
    const user = userEvent.setup();
    render(<MessageList messages={[msg('1', 'what about **b3** here?')]} fen={START_FEN} onHoverMove={onHoverMove} />);

    const move = screen.getByText('b3');
    expect(move.tagName).toBe('STRONG');
    await user.hover(move);
    expect(onHoverMove).toHaveBeenCalledWith({ from: 'b2', to: 'b3' });
  });
});

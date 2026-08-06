import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { BoardContext } from './SessionPeekBar.js';

vi.mock('react-chessboard', () => ({
  Chessboard: () => <div data-testid="mock-chessboard" />
}));

const { MobileSessionBody } = await import('./MobileSessionBody.js');
const { useMobileSessionView } = await import('./useMobileSessionView.js');

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const AT_MOVE_2_BLACK: BoardContext = {
  mode: 'answer',
  ply: 4,
  san: 'Nf3',
  hasDivergedLine: false,
  isAnchoredPreMove: false
};

interface HarnessProps {
  messageCount?: number;
  boardContext?: BoardContext;
}

function Harness({ messageCount = 1, boardContext = AT_MOVE_2_BLACK }: HarnessProps): ReactNode {
  const viewState = useMobileSessionView(messageCount);
  return (
    <MobileSessionBody
      board={
        <button type="button">board control</button>
      }
      chat={<input aria-label="Reply" />}
      fen={START_FEN}
      boardContext={boardContext}
      viewState={viewState}
    />
  );
}

function boardTab(): HTMLElement {
  return screen.getByRole('tab', { name: /board/i });
}

function coachTab(): HTMLElement {
  return screen.getByRole('tab', { name: /coach/i });
}

/** Both panels are always mounted — only one is reachable, so these assert
 * through byRole (which skips aria-hidden subtrees), never byLabelText. */
function boardIsShowing(): boolean {
  return screen.queryByRole('button', { name: 'board control' }) !== null;
}

function coachIsShowing(): boolean {
  return screen.queryByRole('textbox', { name: 'Reply' }) !== null;
}

function swipe(dx: number): void {
  const views = document.querySelector('.session-views');
  if (!views) throw new Error('no swipe surface');
  fireEvent.touchStart(views, { touches: [{ clientX: 200, clientY: 400 }] });
  fireEvent.touchMove(views, { touches: [{ clientX: 200 + dx, clientY: 400 }] });
  fireEvent.touchEnd(views, { touches: [] });
}

describe('MobileSessionBody', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('opens on the coach panel with the board one tap away', () => {
    render(<Harness />);

    expect(coachIsShowing()).toBe(true);
    expect(boardIsShowing()).toBe(false);
    expect(coachTab()).toHaveAttribute('aria-selected', 'true');
  });

  test('tapping Board hands the whole screen to the board', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(boardTab());

    expect(boardIsShowing()).toBe(true);
    expect(coachIsShowing()).toBe(false);
    expect(boardTab()).toHaveAttribute('aria-selected', 'true');

    await user.click(coachTab());
    expect(coachIsShowing()).toBe(true);
  });

  test('swiping switches panels in both directions', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    swipe(120); // rightward: back towards the board
    expect(boardIsShowing()).toBe(true);

    swipe(-120); // leftward: on to the coach
    expect(coachIsShowing()).toBe(true);

    await user.click(boardTab());
    expect(boardIsShowing()).toBe(true);
  });

  test('the coach panel peeks at the position the board is showing', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const peek = screen.getByRole('button', { name: /show board/i });
    expect(peek).toHaveTextContent('after 2…Nf3');

    await user.click(peek);
    expect(boardIsShowing()).toBe(true);
  });

  test('no peek before the coach has moved the board off the starting position', () => {
    render(<Harness boardContext={{ ...AT_MOVE_2_BLACK, ply: 0, san: null }} />);

    expect(screen.queryByRole('button', { name: /show board/i })).not.toBeInTheDocument();
  });

  test('a message arriving while the board is showing marks the Coach tab unread', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness messageCount={1} />);
    await user.click(boardTab());

    rerender(<Harness messageCount={2} />);
    expect(coachTab()).toHaveTextContent('new message');

    await user.click(coachTab());
    expect(coachTab()).not.toHaveTextContent('new message');
  });
});

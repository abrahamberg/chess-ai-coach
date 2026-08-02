import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useLineAutoplay } from './useLineAutoplay.js';

describe('useLineAutoplay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('starts paused and does nothing until toggled', () => {
    const onStep = vi.fn();
    const { result } = renderHook(() => useLineAutoplay(3, 0, 1000, onStep));

    expect(result.current.isPlaying).toBe(false);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onStep).not.toHaveBeenCalled();
  });

  test('ticks at the given interval, proposing the next step', () => {
    const onStep = vi.fn();
    const { result } = renderHook(() => useLineAutoplay(3, 0, 1000, onStep));

    act(() => {
      result.current.toggle();
    });
    expect(result.current.isPlaying).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onStep).toHaveBeenCalledWith(1);
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  test('stops automatically once currentStep reaches stepCount', () => {
    const onStep = vi.fn();
    const { result, rerender } = renderHook(({ currentStep }) => useLineAutoplay(2, currentStep, 1000, onStep), {
      initialProps: { currentStep: 0 }
    });

    act(() => {
      result.current.toggle();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onStep).toHaveBeenCalledWith(1);

    rerender({ currentStep: 1 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onStep).toHaveBeenCalledWith(2);

    rerender({ currentStep: 2 });
    expect(result.current.isPlaying).toBe(false);

    onStep.mockClear();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onStep).not.toHaveBeenCalled();
  });

  test('toggle pauses and resumes playback', () => {
    const onStep = vi.fn();
    const { result } = renderHook(() => useLineAutoplay(5, 0, 1000, onStep));

    act(() => {
      result.current.toggle(); // play
    });
    act(() => {
      result.current.toggle(); // pause
    });
    expect(result.current.isPlaying).toBe(false);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onStep).not.toHaveBeenCalled();

    act(() => {
      result.current.toggle(); // resume
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onStep).toHaveBeenCalledWith(1);
  });

  test('starting playback from an already-finished line (currentStep === stepCount) restarts from 0 instead of doing nothing', () => {
    const onStep = vi.fn();
    const { result, rerender } = renderHook(({ currentStep }) => useLineAutoplay(3, currentStep, 1000, onStep), {
      initialProps: { currentStep: 3 }
    });

    act(() => {
      result.current.toggle();
    });
    expect(onStep).toHaveBeenCalledWith(0);
    expect(result.current.isPlaying).toBe(true);

    // The caller applies onStep(0) by feeding it back in as currentStep —
    // once it does, playback should keep advancing normally from there.
    rerender({ currentStep: 0 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onStep).toHaveBeenCalledWith(1);
  });

  test('cleans up its timer on unmount — no call fires after unmounting', () => {
    const onStep = vi.fn();
    const { result, unmount } = renderHook(() => useLineAutoplay(3, 0, 1000, onStep));

    act(() => {
      result.current.toggle();
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onStep).not.toHaveBeenCalled();
  });
});

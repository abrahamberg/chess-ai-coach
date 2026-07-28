import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useAnnotationLayer } from './AnnotationLayer.js';

describe('useAnnotationLayer', () => {
  test('starts empty', () => {
    const { result } = renderHook(() => useAnnotationLayer());
    expect(result.current.arrows).toEqual([]);
    expect(result.current.highlights).toEqual([]);
  });

  test('setAnnotations replaces arrows and highlights', () => {
    const { result } = renderHook(() => useAnnotationLayer());

    act(() =>
      result.current.setAnnotations({
        arrows: [{ from: 'e2', to: 'e4', color: '#c9762a' }],
        highlights: [{ square: 'd5', color: '#4a7fb5' }]
      })
    );

    expect(result.current.arrows).toHaveLength(1);
    expect(result.current.highlights).toHaveLength(1);
  });

  test('clear() empties both — called whenever the coach calls show_position', () => {
    const { result } = renderHook(() => useAnnotationLayer());
    act(() =>
      result.current.setAnnotations({
        arrows: [{ from: 'e2', to: 'e4', color: '#c9762a' }],
        highlights: [{ square: 'd5', color: '#4a7fb5' }]
      })
    );

    act(() => result.current.clear());

    expect(result.current.arrows).toEqual([]);
    expect(result.current.highlights).toEqual([]);
  });
});

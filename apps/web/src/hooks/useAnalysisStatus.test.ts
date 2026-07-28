import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useAnalysisStatus } from './useAnalysisStatus.js';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
});

describe('useAnalysisStatus', () => {
  test('connects to the analysis status SSE endpoint and updates on message', () => {
    const { result } = renderHook(() => useAnalysisStatus('abc'));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toBe('/api/analyses/abc/status');

    act(() => {
      MockEventSource.instances[0]?.emit({ status: 'engine_running' });
    });

    expect(result.current.status).toBe('engine_running');
  });

  test('does not open a connection when analysisId is null', () => {
    renderHook(() => useAnalysisStatus(null));

    expect(MockEventSource.instances).toHaveLength(0);
  });

  test('closes the connection on unmount', () => {
    const { unmount } = renderHook(() => useAnalysisStatus('abc'));

    unmount();

    expect(MockEventSource.instances[0]?.closed).toBe(true);
  });
});

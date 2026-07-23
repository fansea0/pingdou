import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Palette, PipelineResult, ProcessParams, UIStatus } from '@/types';

const { exportMultiMock, initMock, processMock } = vi.hoisted(() => ({
  exportMultiMock: vi.fn<
    (
      src: ImageData,
      exportCellPx: number,
      selectedGridSize: number,
      extraGridSizes: number[],
      removeBackground: boolean,
      simplifyColors: boolean,
    ) => Promise<{ success: number; failed: number }>
  >(),
  initMock: vi.fn<(palette: Palette) => void>(),
  processMock: vi.fn<
    (
      src: ImageData,
      params: ProcessParams,
      onStatus: (status: UIStatus) => void,
      onResult: (result: PipelineResult) => void,
    ) => Promise<void>
  >(),
}));

vi.mock('@/pipeline/pipeline', () => ({
  Pipeline: class MockPipeline {
    init(palette: Palette): void {
      initMock(palette);
    }

    process(
      src: ImageData,
      params: ProcessParams,
      onStatus: (status: UIStatus) => void,
      onResult: (result: PipelineResult) => void,
    ): Promise<void> {
      return processMock(src, params, onStatus, onResult);
    }

    exportMulti(
      src: ImageData,
      exportCellPx: number,
      selectedGridSize: number,
      extraGridSizes: number[],
      removeBackground: boolean,
      simplifyColors: boolean,
    ): Promise<{ success: number; failed: number }> {
      return exportMultiMock(
        src,
        exportCellPx,
        selectedGridSize,
        extraGridSizes,
        removeBackground,
        simplifyColors,
      );
    }
  },
}));

import { usePipeline } from './usePipeline';

const palette: Palette = [{ id: 'A01', rgb: [100, 100, 100], name: '灰' }];
const pipelineResult: PipelineResult = {
  indices: new Uint8Array([0]),
  gridSize: 32,
  outW: 1,
  outH: 1,
  token: 1,
  mask: new Uint8Array([0]),
  simplifyColors: false,
  colorSimplification: {
    beforeColorCount: 1,
    afterColorCount: 1,
    mergedColorCount: 0,
    rareColorCountBefore: 0,
    rareColorCountAfter: 0,
    minimumColorCountSatisfied: false,
  },
};

function source(): ImageData {
  return new ImageData(Uint8ClampedArray.from([100, 100, 100, 255]), 1, 1);
}

describe('usePipeline throttled settings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.clearAllMocks();
    processMock.mockImplementation(async (_src, _params, onStatus, onResult) => {
      onStatus('ready');
      onResult(pipelineResult);
    });
    exportMultiMock.mockResolvedValue({ success: 1, failed: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('processes and exports the latest complete settings from a trailing burst', async () => {
    const image = source();
    const { result } = renderHook(() => usePipeline(palette));

    await act(async () => {
      result.current.process(image, {
        gridSize: 19,
        removeBackground: true,
        simplifyColors: true,
      });
      result.current.reprocess({
        gridSize: 24,
        removeBackground: false,
        simplifyColors: true,
      });
      result.current.reprocess({
        gridSize: 40,
        removeBackground: true,
        simplifyColors: false,
      });
      result.current.reprocess({
        gridSize: 32,
        removeBackground: false,
        simplifyColors: false,
      });
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(processMock).toHaveBeenCalledTimes(1);
    expect(processMock.mock.calls[0][1]).toEqual({
      gridSize: 32,
      removeBackground: false,
      simplifyColors: false,
    });

    await act(async () => {
      await result.current.exportMulti(24, 32, []);
    });

    expect(exportMultiMock).toHaveBeenCalledWith(image, 24, 32, [], false, false);
  });
});
